const labels = {
  walk: 'เดิน',
  car: 'รถรับจ้าง',
  own: 'รถส่วนตัว',
  van: 'รถตู้',
  red: 'รถแดง',
  transit: 'ขนส่งสาธารณะ',
};
const colors = {
  walk: '#41793a',
  car: '#3c699a',
  own: '#295d73',
  van: '#926025',
  red: '#a7453b',
  transit: '#695396',
};
export function coordinates(value) {
  const pair = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [value?.lat, value?.lng];
  if (pair.length !== 2 || pair.some((n) => n == null || String(n).trim() === '')) return;
  let [lat, lng] = pair.map(Number);
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
  if ([lat, lng].every(Number.isFinite) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng))
    return [lng, lat];
}
const distance = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
function segment(a, b, record, mode, ghost = false) {
  let points = record?.geom || (Array.isArray(record) ? record : null);
  if (
    points?.length >= 2 &&
    points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
  ) {
    if (distance(a, points[0]) > distance(a, [points[0][1], points[0][0]]))
      points = points.map(([x, y]) => [y, x]);
  } else points = null;
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: points || [a, b] },
    properties: {
      mode,
      color: ghost ? '#a84646' : colors[mode] || '#426353',
      approx: !points || Boolean(record?.approx) || ghost,
    },
  };
}
let map,
  loading,
  library,
  pending,
  markers = [],
  previousCamera;

const pinSpacing = 35;
const detailZoom = 17.5;

// Search outward in screen pixels. Each marker keeps its true geographic coordinate.
function spreadPins() {
  if (!map || !markers.length) return;
  const placed = [];
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  const clear = (x, y) => placed.every((point) => Math.hypot(x - point.x, y - point.y) >= pinSpacing - 0.1);
  const focused = markers.find((item) => item.marker.getElement().dataset.focused === 'true');
  const order = focused ? [focused, ...markers.filter((item) => item !== focused)] : markers;
  for (const { marker, leader } of order) {
    const anchor = map.project(marker.getLngLat());
    if (![anchor.x, anchor.y].every(Number.isFinite)) continue;
    let dx = 0,
      dy = 0;
    if (!clear(anchor.x, anchor.y)) {
      let fallback;
      const onScreen = anchor.x >= 0 && anchor.x <= width && anchor.y >= 0 && anchor.y <= height;
      search: for (let ring = 1; ; ring++) {
        const candidates = ring * 6;
        for (let j = 0; j < candidates; j++) {
          const angle = (2 * Math.PI * j) / candidates;
          const x = Math.round(Math.cos(angle) * pinSpacing * ring);
          const y = Math.round(Math.sin(angle) * pinSpacing * ring);
          const left = anchor.x + x,
            top = anchor.y + y;
          if (!clear(left, top)) continue;
          fallback ??= [x, y];
          if (onScreen && (left < 16 || left > width - 16 || top < 16 || top > height - 16)) continue;
          [dx, dy] = [x, y];
          break search;
        }
        if (fallback && ring * pinSpacing > Math.min(width, height) / 2) {
          [dx, dy] = fallback;
          break;
        }
      }
    }
    placed.push({ x: anchor.x + dx, y: anchor.y + dy });
    const old = marker.getOffset();
    if (old.x === dx && old.y === dy) continue;
    marker.setOffset([dx, dy]);
    const length = Math.hypot(dx, dy);
    leader.hidden = !length;
    if (length) {
      // Start the connector outside the numbered circle and finish at the actual route endpoint.
      leader.style.width = length - 13 + 'px';
      leader.style.transform = 'rotate(' + Math.atan2(-dy, -dx) + 'rad) translateX(13px)';
    }
  }
}

function paint() {
  if (!map?.isStyleLoaded() && !map?.getSource('trip')) return;
  const { days, routes, before, open, focusedStop } = pending;
  let focusPoint;
  const points = [],
    features = [],
    modesUsed = new Set();
  const activePin = document.activeElement?.closest('.map-pin')?.dataset.mapStop;
  for (const { marker } of markers) marker.remove();
  markers = [];
  function pin(stop, p, index, ghost) {
    points.push(p);
    if (stop.id === focusedStop) focusPoint = p;
    const el = document.createElement('button');
    el.className = 'map-pin' + (ghost ? ' removed' : '');
    el.type = 'button';
    el.setAttribute('role', 'button');
    el.dataset.mapStop = stop.id;
    el.dataset.focused = String(stop.id === focusedStop);
    el.textContent = ghost ? '−' : String(index + 1);
    el.title = (ghost ? 'นำออก · ' : '') + stop.name;
    el.setAttribute('aria-label', el.title);
    const leader = document.createElement('span');
    leader.hidden = true;
    leader.setAttribute('aria-hidden', 'true');
    Object.assign(leader.style, {
      position: 'absolute',
      pointerEvents: 'none',
      left: '50%',
      top: '50%',
      height: '2px',
      background: '#53657b',
      boxShadow: '0 0 1px white',
      transformOrigin: 'left center',
    });
    el.append(leader);
    el.onclick = (event) => {
      event.stopPropagation();
      previousCamera = undefined;
      open(stop);
    };
    const marker = new library.Marker({ element: el }).setLngLat(p).addTo(map);
    markers.push({ marker, leader });
    if (stop.id === activePin) el.focus({ preventScroll: true });
  }
  for (const day of days.filter(Boolean)) {
    const stops = day.stops || [];
    stops.forEach((stop, i) => {
      const p = coordinates(stop.ll),
        a = coordinates(stops[i - 1]?.ll);
      if (p) pin(stop, p, i, false);
      if (!p || !a || !stop.leg) return;
      const mode = stop.leg.mode || stop.leg.m;
      const line = segment(a, p, routes?.[stop.leg.key], mode);
      features.push(line);
      modesUsed.add(mode);
      if (stop.leg.km >= 100) points.push(...line.geometry.coordinates);
    });
    if (before) {
      const kept = new Set(stops.map((s) => s.id));
      before.stops.forEach((stop, i, old) => {
        const p = coordinates(stop.ll);
        if (!p || kept.has(stop.id)) return;
        pin(stop, p, i, true);
        for (const adjacent of [old[i - 1], old[i + 1]]) {
          const other = coordinates(adjacent?.ll);
          if (other) features.push(segment(p, other, null, 'walk', true));
        }
      });
    }
  }
  const data = { type: 'FeatureCollection', features };
  if (map.getSource('trip')) map.getSource('trip').setData(data);
  else {
    map.addSource('trip', { type: 'geojson', data });
    for (const approx of [false, true]) {
      const id = approx ? 'trip-approx' : 'trip-road';
      map.addLayer({
        id,
        type: 'line',
        source: 'trip',
        filter: ['==', ['get', 'approx'], approx],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4,
          'line-opacity': approx ? 0.52 : 0.9,
          ...(approx ? { 'line-dasharray': [2, 2] } : {}),
        },
      });
      map.on('click', id, (event) =>
        new library.Popup()
          .setLngLat(event.lngLat)
          .setText(approx ? 'เส้นทางโดยประมาณ' : 'ตามถนนจริง')
          .addTo(map),
      );
    }
  }
  document.querySelector('#leg-label').textContent =
    [...modesUsed].map((m) => labels[m] || m).join(' · ') +
    (features.some((f) => f.properties.approx) ? ' · เส้นประโดยประมาณ' : '');
  map.resize();
  spreadPins();
  const camera = JSON.stringify([focusedStop, days.map((d) => d?.stops?.map((s) => [s.id, s.ll]))]);
  if (camera === previousCamera) return;
  previousCamera = camera;
  if (focusPoint) {
    map.easeTo({ center: focusPoint, zoom: Math.max(map.getZoom(), detailZoom), duration: 280 });
  } else if (points.length) {
    const bounds = points.reduce((box, p) => box.extend(p), new library.LngLatBounds(points[0], points[0]));
    map.fitBounds(bounds, { padding: 35, maxZoom: 14, duration: 0 });
  }
}
export function drawMap(days, routes, open, before, focusedStop) {
  pending = { days, routes, open, before, focusedStop };
  if (map) {
    paint();
    return;
  }
  if (loading || !days.some((day) => day?.stops?.length)) return;
  loading = import('/assets/maplibre-gl.mjs?v=6.19.0')
    .then((lib) => {
      library = lib;
      lib.setWorkerUrl('/assets/maplibre-gl-worker.mjs?v=6.19.0');
      const container = document.querySelector('#map');
      container.replaceChildren();
      const dark = matchMedia('(prefers-color-scheme: dark)');
      const style = () => 'https://tiles.openfreemap.org/styles/' + (dark.matches ? 'dark' : 'positron');
      map = new lib.Map({ container, style: style(), center: [100.5, 13.75], zoom: 5, scrollZoom: false });
      for (const event of ['zoom', 'rotate', 'pitch', 'resize', 'moveend']) map.on(event, spreadPins);
      let baseReady = false;
      map.on('error', () => {
        if (!baseReady && !map.isStyleLoaded()) {
          baseReady = true;
          map.setStyle({
            version: 8,
            sources: {},
            layers: [{ id: 'backdrop', type: 'background', paint: { 'background-color': '#e4eade' } }],
          });
        }
      });
      map.addControl(new lib.NavigationControl({ showCompass: false }));
      map.on('style.load', () => {
        baseReady = true;
        for (const layer of map.getStyle().layers || []) {
          if (
            layer.type === 'symbol' &&
            layer.layout?.['text-field'] &&
            /name/.test(JSON.stringify(layer.layout['text-field']))
          ) {
            map.setLayoutProperty(layer.id, 'text-field', [
              'coalesce',
              ['get', 'name:th'],
              ['get', 'name'],
              layer.layout['text-field'],
            ]);
          }
        }
        map.once('idle', paint);
        paint();
      });
      dark.addEventListener('change', () => map.setStyle(style()));
    })
    .catch(() => {
      document.querySelector('#map').textContent = 'เปิดแผนที่ไม่สำเร็จ ดูจุดแวะและเส้นทางในกำหนดการได้';
    });
}
