export type LynnwoodCamera = {
  name: string;
  id: string;
  lat: number;
  lon: number;
  iframeUrl: string;
};

const LYNNWOOD_PLAYER_GROUP = '9ed25a24-311d-d2ef-0d72-570169410fec';

const cameras = [
  { name: '188th ST SW / 44th Ave W', id: 'a1ee3da2-2ff3-49d1-bc97-a1c4464bc3b4', lat: 47.82613, lon: -122.29320 },
  { name: '184th St SW / 32nd Ave W', id: '5e05c085-44b4-c968-490d-33cf080eb5c5', lat: 47.83065, lon: -122.27414 },
  { name: '179th St SW / 36th Ave W', id: 'a4f1f87c-773f-57df-f551-1759111d89af', lat: 47.83355, lon: -122.28225 },
  { name: '176th St SW / Highway 99', id: '3909c26f-66f4-c089-a519-537c54374253', lat: 47.83835, lon: -122.31490 },
  { name: '196th St SW / Highway 99', id: 'c3bc355a-f204-fe0d-a03c-2b9dd99f2678', lat: 47.82048, lon: -122.31592 },
  { name: '196th St SW / Alderwood Mall Pkwy', id: '8ac5f74d-5b2e-7902-f0d0-0f1c711913c9', lat: 47.82180, lon: -122.27190 },
  { name: '212th St SW / 44th Ave W', id: 'e3c553b9-6261-3a2a-9717-ed8d4a164087', lat: 47.80525, lon: -122.29320 },
  { name: '196th St SW / 24th Ave W', id: '6941c646-c604-9cff-7284-6da2e733c40e', lat: 47.82095, lon: -122.26690 },
  { name: '172nd St SW / 36th Ave W', id: '9c88d216-1860-3790-ce65-707d355fa441', lat: 47.84290, lon: -122.28225 },
  { name: '168th St SW / Highway 99', id: '4358970c-5a0f-2ec4-bed1-be5a4f5e3462', lat: 47.84642, lon: -122.31490 },
  { name: '196th St SW / 68th Ave W', id: 'b042579a-0436-bc9a-b00a-eaf4864c5feb', lat: 47.82180, lon: -122.32775 },
  { name: '176th St SW / Olympic View Drive', id: '43226b26-cac7-5483-788a-69f0dc458343', lat: 47.83835, lon: -122.31518 },
  { name: '168th St SW / Olympic View Drive', id: 'c96cc8f4-862b-341e-a518-8d127d1ffe4d', lat: 47.84642, lon: -122.31518 },
];

export const lynnwoodCameras: LynnwoodCamera[] = cameras.map((camera) => ({
  ...camera,
  iframeUrl: `https://iframe.dacast.com/live/${LYNNWOOD_PLAYER_GROUP}/${camera.id}`,
}));
