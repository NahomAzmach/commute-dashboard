export type Checkpoint = {
  id: number;
  title: string;
  lat: number;
  lon: number;
  imageUrl: string;
};

export type Route = {
  key: 'primary' | 'alternate';
  label: string;
  checkpoints: Checkpoint[];
};

export const HOME = '6709 45th Pl NE, Marysville, WA';
export const WORK = '777 108th Ave NE, Bellevue, WA (Symetra)';
export const USUAL_LEAVE_TIME = '06:30';

// Approximate - anchored to the nearest checkpoint camera rather than a
// separate geocode, since that's already the closest real position we track.
export const HOME_COORDS = { lat: 48.051817, lon: -122.184422 };
export const WORK_COORDS = { lat: 47.617487, lon: -122.188531 };

export const ROUTES: Route[] = [
  {
    key: 'primary',
    label: 'I-5 to I-405',
    checkpoints: [
      { id: 9270, title: 'I-5 at MP 199.1: SR 528 Interchange (Marysville, near home)', lat: 48.051817, lon: -122.184422, imageUrl: 'https://images.wsdot.wa.gov/nw/005vc19910.jpg' },
      { id: 1048, title: 'I-5 at MP 189.3: SR 526 Interchange (Everett)', lat: 47.91915, lon: -122.206265, imageUrl: 'https://images.wsdot.wa.gov/nw/005vc18934.jpg' },
      { id: 1082, title: 'I-405 at MP 24.5: NE 195th St (Lynnwood merge)', lat: 47.769271, lon: -122.189462, imageUrl: 'https://images.wsdot.wa.gov/nw/405vc02452.jpg' },
      { id: 9635, title: 'I-405 at MP 20.6: NE 128th St (Totem Lake/Kirkland)', lat: 47.714982, lon: -122.185129, imageUrl: 'https://images.wsdot.wa.gov/nw/405vc02066.jpg' },
      { id: 1380, title: 'I-405 at MP 17.4: NE 70th Pl (Kirkland/Houghton)', lat: 47.669376, lon: -122.187438, imageUrl: 'https://images.wsdot.wa.gov/nw/405vc01742.jpg' },
      { id: 1196, title: 'I-405 at MP 14.8: SR 520 Interchange (north Bellevue)', lat: 47.631932, lon: -122.187799, imageUrl: 'https://images.wsdot.wa.gov/nw/405vc01483.jpg' },
      { id: 1073, title: 'I-405 at MP 13.8: NE 8th St (Bellevue exit, near Symetra)', lat: 47.617487, lon: -122.188531, imageUrl: 'https://images.wsdot.wa.gov/nw/405vc01383.jpg' },
    ],
  },
  {
    key: 'alternate',
    label: 'SR 9 to SR 522 to I-405',
    checkpoints: [
      { id: 9312, title: 'SR 9 at MP 17.5: SR 92 Interchange (near home)', lat: 48.028186, lon: -122.110248, imageUrl: 'https://images.wsdot.wa.gov/nw/009vc01751.jpg' },
      { id: 9987, title: 'SR 9 at MP 15.4: Market Pl (Snohomish)', lat: 47.998175, lon: -122.105569, imageUrl: 'https://images.wsdot.wa.gov/nw/009vc01544.jpg' },
      { id: 9077, title: 'SR 522 at MP 10.5: S Campus Way (Woodinville)', lat: 47.755382, lon: -122.194456, imageUrl: 'https://images.wsdot.wa.gov/nw/522vc01056.jpg' },
      { id: 1383, title: 'I-405 at MP 23.6: SR 522 Interchange (merge point)', lat: 47.757772, lon: -122.184242, imageUrl: 'https://images.wsdot.wa.gov/nw/405vc02371.jpg' },
      { id: 9635, title: 'I-405 at MP 20.6: NE 128th St (Totem Lake/Kirkland)', lat: 47.714982, lon: -122.185129, imageUrl: 'https://images.wsdot.wa.gov/nw/405vc02066.jpg' },
      { id: 1380, title: 'I-405 at MP 17.4: NE 70th Pl (Kirkland/Houghton)', lat: 47.669376, lon: -122.187438, imageUrl: 'https://images.wsdot.wa.gov/nw/405vc01742.jpg' },
      { id: 1196, title: 'I-405 at MP 14.8: SR 520 Interchange (north Bellevue)', lat: 47.631932, lon: -122.187799, imageUrl: 'https://images.wsdot.wa.gov/nw/405vc01483.jpg' },
      { id: 1073, title: 'I-405 at MP 13.8: NE 8th St (Bellevue exit, near Symetra)', lat: 47.617487, lon: -122.188531, imageUrl: 'https://images.wsdot.wa.gov/nw/405vc01383.jpg' },
    ],
  },
];
