import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { getWsdotCatalog } from '../../../lib/wsdot';
import { getSeattleCameraCatalog } from '../../../lib/seattleCams';

const kv = Redis.fromEnv();
const LOG_KEY = 'training:log';
const SAMPLE_CAP = 20000;
const MAX_RESULTS = 15;
const VALID_HOURS = new Set([1, 3, 6, 12, 24]);

type TrainingRow = {
  cameraId: number;
  timestamp: number;
  condition: string;
  change: number | null;
  flowReading: number | null;
  travelRatio: number | null;
  incident: boolean;
};

type CameraEntry = {
  id: number;
  title: string;
  lat: number;
  lon: number;
  imageUrl: string;
};

type ObservationPair = {
  latest: TrainingRow;
  previous: TrainingRow | null;
};

const FLOW_LABELS: Record<number, string> = {
  0: 'Unknown',
  1: 'Wide open',
  2: 'Moderate',
  3: 'Heavy',
  4: 'Stop and go',
  5: 'No data',
};

const INTENT_WORDS =
  /\b(find|show|me|the|camera|cameras|traffic|condition|conditions|right|now|current|currently|in|around|near|at|within|area|somewhere|anywhere|worst|most|bad|busy|with|for|and|or|on|of|what|where|is|are|there|look|looking|see|check|please)\b/g;

const CITIES = [
  { name: 'Seattle', lat: 47.6062, lon: -122.3321 },
  { name: 'Everett', lat: 47.978, lon: -122.2021 },
  { name: 'Tacoma', lat: 47.2529, lon: -122.4443 },
  { name: 'Bellevue', lat: 47.6101, lon: -122.2015 },
  { name: 'Lynnwood', lat: 47.8209, lon: -122.3151 },
  { name: 'Redmond', lat: 47.674, lon: -122.1215 },
  { name: 'Renton', lat: 47.4829, lon: -122.2171 },
  { name: 'Kent', lat: 47.3809, lon: -122.2348 },
  { name: 'Federal Way', lat: 47.3223, lon: -122.3126 },
  { name: 'Bremerton', lat: 47.5673, lon: -122.6326 },
  { name: 'Olympia', lat: 47.0379, lon: -122.9007 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRow(value: unknown): TrainingRow | null {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;
  if (
    !Number.isFinite(parsed.cameraId) ||
    !Number.isFinite(parsed.timestamp) ||
    typeof parsed.condition !== 'string'
  ) {
    return null;
  }
  return {
    cameraId: parsed.cameraId as number,
    timestamp: parsed.timestamp as number,
    condition: parsed.condition,
    change: Number.isFinite(parsed.change) ? (parsed.change as number) : null,
    flowReading: Number.isFinite(parsed.flowReading) ? (parsed.flowReading as number) : null,
    travelRatio: Number.isFinite(parsed.travelRatio) ? (parsed.travelRatio as number) : null,
    incident: parsed.incident === true,
  };
}

function distanceMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const toRadians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRadians;
  const dLon = (b.lon - a.lon) * toRadians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRadians) *
      Math.cos(b.lat * toRadians) *
      Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

function getArea(camera: CameraEntry): string | null {
  let nearest: (typeof CITIES)[number] | null = null;
  let nearestDistance = Infinity;
  for (const city of CITIES) {
    const distance = distanceMiles(camera, city);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = city;
    }
  }
  return nearest && nearestDistance <= 12 ? nearest.name : null;
}

function getCorridor(camera: CameraEntry): string {
  const route = camera.title.match(/\b(I|US|SR|WA)\s*-?\s*(\d{1,3})\b/i);
  return route ? `${route[1].toUpperCase()}-${route[2]}` : getArea(camera) ?? 'Puget Sound';
}

function isPugetSoundCamera(camera: CameraEntry): boolean {
  return camera.lat >= 46.8 && camera.lat <= 48.5 && camera.lon >= -123.5 && camera.lon <= -121.3;
}

function getSeverity(row: TrainingRow): number {
  const visionScore: Record<string, number> = {
    clear: 0,
    slow: 1,
    congested: 2,
    stopped: 3,
    unreadable: -1,
  };
  const scores = [visionScore[row.condition]];
  if (row.flowReading === 1) scores.push(0);
  if (row.flowReading === 2) scores.push(1);
  if (row.flowReading === 3) scores.push(2);
  if (row.flowReading === 4) scores.push(3);
  if (row.travelRatio !== null) {
    scores.push(Math.min(3, Math.max(0, (row.travelRatio - 1) * 4)));
  }
  const usableScores = scores.filter((score) => Number.isFinite(score) && score >= 0);
  const strongest = usableScores.length ? Math.max(...usableScores) : 0;
  const corroboration = usableScores.filter((score) => score >= 2).length > 1 ? 0.25 : 0;
  return strongest + corroboration + (row.incident ? 0.5 : 0);
}

function matchesQuery(row: TrainingRow, camera: CameraEntry, query: string): boolean {
  const normalized = query.toLowerCase();
  const wantsIncident = /\b(incidents?|collisions?|closures?|crashes?)\b/.test(normalized);
  const wantsStopped = /\b(stopped|standstill)\b/.test(normalized);
  const wantsSlow = /\b(slow|delay|slowing)\b/.test(normalized);
  const wantsCongestion = /\b(congest|congestion|congested|heavy|jam|backup|backed up)\b/.test(
    normalized,
  );
  const wantsClear = /\b(clear|free flowing|free-flowing)\b/.test(normalized);
  const wantsPugetSound = /\bpuget\b|\bpuget sound\b/.test(normalized);
  const hasConditionIntent =
    wantsIncident || wantsStopped || wantsSlow || wantsCongestion || wantsClear || wantsPugetSound;

  if (wantsPugetSound && !isPugetSoundCamera(camera)) return false;
  if (wantsIncident && !row.incident) return false;
  if (wantsStopped && row.condition !== 'stopped' && row.flowReading !== 4) return false;
  if (
    wantsCongestion &&
    !wantsStopped &&
    !['congested', 'stopped'].includes(row.condition) &&
    row.flowReading !== 3 &&
    row.flowReading !== 4 &&
    !(row.travelRatio !== null && row.travelRatio >= 1.15)
  ) {
    return false;
  }
  if (
    wantsSlow &&
    !wantsCongestion &&
    row.condition !== 'slow' &&
    row.flowReading !== 2 &&
    !(row.travelRatio !== null && row.travelRatio >= 1.05)
  ) {
    return false;
  }
  if (
    wantsClear &&
    (row.condition !== 'clear' ||
      row.flowReading === 3 ||
      row.flowReading === 4 ||
      (row.travelRatio !== null && row.travelRatio >= 1.15))
  ) {
    return false;
  }

  const locationWords = normalized
    .replace(INTENT_WORDS, ' ')
    .replace(
      /\b(incidents?|collisions?|closures?|crashes?|stopped|standstill|slow|delay|slowing|congest(?:ion|ed)?|heavy|jam|backup|backed up|clear|free flowing|puget|sound)\b/g,
      ' ',
    )
    .split(/\s+/)
    .filter((word) => word.length > 1);
  if ((!hasConditionIntent || wantsPugetSound) && locationWords.length === 0) return true;
  if (locationWords.length === 0) return true;

  const searchable = `${camera.title} ${getArea(camera) ?? ''}`.toLowerCase();
  return locationWords.every((word) => searchable.includes(word));
}

async function getRecentObservations(
  startTime: number,
  endTime: number,
): Promise<{ observationsByCamera: Map<number, ObservationPair>; sampledRows: number }> {
  const total = await kv.llen(LOG_KEY);
  const limit = Math.min(total, SAMPLE_CAP);
  const batchSize = 1000;
  const observationsByCamera = new Map<number, ObservationPair>();
  let sampledRows = 0;

  for (let start = 0; start < limit; start += batchSize) {
    const batch = await kv.lrange<string>(LOG_KEY, start, Math.min(limit - 1, start + batchSize - 1));
    sampledRows += batch.length;
    for (const value of batch) {
      const row = parseRow(value);
      if (!row || row.timestamp < startTime || row.timestamp > endTime) continue;
      const existing = observationsByCamera.get(row.cameraId);
      if (!existing) {
        observationsByCamera.set(row.cameraId, { latest: row, previous: null });
      } else if (row.timestamp > existing.latest.timestamp) {
        existing.previous = existing.latest;
        existing.latest = row;
      } else if (
        row.timestamp < existing.latest.timestamp &&
        (!existing.previous || row.timestamp > existing.previous.timestamp)
      ) {
        existing.previous = row;
      }
    }
  }

  return { observationsByCamera, sampledRows };
}

export async function GET(req: NextRequest) {
  const query = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 120);
  const requestedHours = Number(req.nextUrl.searchParams.get('hours') ?? 3);
  const hours = VALID_HOURS.has(requestedHours) ? requestedHours : 3;
  const endTime = Date.now();
  const startTime = endTime - hours * 60 * 60 * 1000;

  try {
    const { observationsByCamera, sampledRows } = await getRecentObservations(startTime, endTime);

    const [wsdotCameras, seattleCameras] = await Promise.all([
      getWsdotCatalog(),
      getSeattleCameraCatalog().catch(() => []),
    ]);
    const catalog = new Map<number, CameraEntry>(
      [...wsdotCameras, ...seattleCameras].map((camera) => [camera.id, camera]),
    );
    const allResults = [...observationsByCamera.values()]
      .flatMap(({ latest: row, previous }) => {
        const camera = catalog.get(row.cameraId);
        if (!camera || !matchesQuery(row, camera, query)) return [];
        return [
          {
            cameraId: row.cameraId,
            title: camera.title,
            imageUrl: camera.imageUrl,
            corridor: getCorridor(camera),
            condition: row.condition,
            previousCondition: previous?.condition ?? null,
            previousTimestamp: previous?.timestamp ?? null,
            change: row.change,
            flowReading: row.flowReading,
            flowLabel: row.flowReading === null ? null : (FLOW_LABELS[row.flowReading] ?? 'Unknown'),
            travelRatio: row.travelRatio,
            incident: row.incident,
            timestamp: row.timestamp,
            severity: getSeverity(row),
          },
        ];
      })
      .sort((a, b) => b.severity - a.severity || b.timestamp - a.timestamp);

    const corridorGroups = new Map<
      string,
      { cameraCount: number; incidents: number; severity: number }
    >();
    for (const result of allResults) {
      const group = corridorGroups.get(result.corridor);
      if (!group) {
        corridorGroups.set(result.corridor, {
          cameraCount: 1,
          incidents: Number(result.incident),
          severity: result.severity,
        });
      } else {
        group.cameraCount += 1;
        group.incidents += Number(result.incident);
        group.severity = Math.max(group.severity, result.severity);
      }
    }

    const corridors = [...corridorGroups.entries()]
      .map(([name, group]) => ({ name, ...group }))
      .sort((a, b) => b.severity - a.severity || b.cameraCount - a.cameraCount)
      .slice(0, 8);

    return NextResponse.json(
      {
        query,
        hours,
        sampledRows,
        analyzedCameraCount: observationsByCamera.size,
        corridors,
        results: allResults.slice(0, MAX_RESULTS),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Camera query failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
