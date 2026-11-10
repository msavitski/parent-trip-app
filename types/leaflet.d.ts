/* The few parts of Leaflet (web/vendor/leaflet-*) that web/js/admin/map.js uses. The full types are in @types/leaflet;
   the app loads the library with a <script> tag, so the type checker never sees it. */

export interface LeafletLib {
  map(element: HTMLElement): LMap;
  tileLayer(url: string, options: { maxZoom: number; attribution: string }): { addTo(map: LMap): unknown };
  divIcon(options: {
    className: string;
    html: string;
    iconSize: [number, number];
    iconAnchor: [number, number];
  }): unknown;
  marker(position: [number, number], options: { icon: unknown; keyboard: boolean }): LMarker;
}

export interface LMap {
  setView(center: [number, number], zoom: number): LMap;
  on(type: 'click', handler: (event: { latlng: { lat: number; lng: number } }) => void): LMap;
  remove(): void;
}

export interface LMarker {
  addTo(map: LMap): LMarker;
  setLatLng(position: [number, number]): LMarker;
}

declare global {
  interface Window {
    /** Set by Leaflet's script once it has loaded. */
    L?: LeafletLib;
  }
}
