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
const strokes = {
  road: { width: 4, cap: 'round' },
  walk: { width: 3, cap: 'round', dash: [0.1, 2.6] },
  transit: { width: 4, cap: 'butt', dash: [3, 1.5] },
  estimate: { width: 3, cap: 'butt', dash: [3, 1.4, 0.7, 1.4], opacity: 0.76 },
  removed: { width: 3, cap: 'butt', dash: [1.2, 1.3], opacity: 0.83 },
};
function routeLabel({ mode, stroke }) {
  if (stroke === 'removed') return 'เส้นทางที่นำออก';
  return (labels[mode] || mode || 'การเดินทาง') + (stroke === 'estimate' ? ' · เส้นทางโดยประมาณ' : '');
}
function renderLegend(features) {
  const legend = document.querySelector('#leg-label');
  const entries = new Map();
  for (const { properties } of features) entries.set(routeLabel(properties), properties);
  const items = [];
  for (const [label, { color, stroke }] of entries) {
    const style = strokes[stroke];
    const item = document.createElement('li');
    const swatch = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    swatch.setAttribute('viewBox', '0 0 38 10');
    swatch.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS(swatch.namespaceURI, 'path');
    line.setAttribute('d', 'M2 5H36');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-linecap', style.cap);
    line.setAttribute('stroke-width', style.width);
    if (style.opacity) line.setAttribute('opacity', style.opacity);
    if (style.dash) line.setAttribute('stroke-dasharray', style.dash.map(n => n * style.width).join(' '));
    swatch.append(line);
    item.append(swatch, document.createTextNode(label));
    items.push(item);
  }
  legend.replaceChildren(...items);
  legend.hidden = !items.length;
}
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
function segment(a, b, record, mode, ghost = false, estimated = false) {
  let points = record?.geom || (Array.isArray(record) ? record : null);
  if (
    points?.length >= 2 &&
    points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
  ) {
    if (distance(a, points[0]) > distance(a, [points[0][1], points[0][0]]))
      points = points.map(([x, y]) => [y, x]);
  } else points = null;
  const approximate = !points || Boolean(record?.approx) || estimated;
  const stroke = ghost ? 'removed' : approximate ? 'estimate' : mode === 'walk' || mode === 'transit' ? mode : 'road';
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: points || [a, b] },
    properties: {
      mode,
      color: ghost ? '#a84646' : colors[mode] || '#426353',
      approx: approximate || ghost,
      stroke,
      revision: overlayRevision,
    },
  };
}
let map,
  loading,
  library,
  pending,
  markers = [],
  routePopup,
  overlayRevision = 0,
  previousCamera,
  cameraTarget,
  cameraFrame;

const pinSpacing = 35;
const detailZoom = 17.5;
const lineFilter = stroke => ['all', ['==', ['get', 'stroke'], stroke], ['==', ['get', 'revision'], overlayRevision]];

// Split the map around the visible docks. On small workspaces there can be more
// room below the chat than between the chat and the place sheet.
function visibleFrame(mapBox) {
  let areas = [mapBox];
  for (const id of ['place-panel', 'chat-response']) {
    const dock = document.getElementById(id)?.getBoundingClientRect();
    if (!dock?.width || !dock.height) continue;
    areas = areas.flatMap(area => {
      if (dock.left >= area.right || dock.right <= area.left || dock.top >= area.bottom || dock.bottom <= area.top)
        return [area];
      return [
        { ...area, right: dock.left }, { ...area, left: dock.right },
        { ...area, bottom: dock.top }, { ...area, top: dock.bottom },
      ].filter(rect => rect.right > rect.left && rect.bottom > rect.top);
    });
  }
  const room = rect => (rect.right - rect.left) * (rect.bottom - rect.top);
  return areas.reduce((largest, rect) => !largest || room(rect) > room(largest) ? rect : largest, null) || mapBox;
}

function scheduleCamera() {
  if (cameraFrame || !cameraTarget) return;
  cameraFrame = requestAnimationFrame(() => {
    cameraFrame = undefined;
    if (!cameraTarget) return;
    const box = map.getContainer().getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;
    map.resize();
    const rect = visibleFrame({ left: box.left, top: box.top, right: box.right, bottom: box.bottom });
    const gutter = Math.min(35, (rect.right - rect.left) / 4, (rect.bottom - rect.top) / 4);
    const padding = {
      left: rect.left - box.left + gutter, right: box.right - rect.right + gutter,
      top: rect.top - box.top + gutter, bottom: box.bottom - rect.bottom + gutter,
    };
    const { bounds, focus, focusedStop, drafting, center } = cameraTarget;
    const signature = JSON.stringify([box.width, box.height, padding, bounds, focus, focusedStop, drafting, center]);
    if (signature === previousCamera) return;
    previousCamera = signature;
    if (focus) {
      const offset = [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2];
      map.easeTo({ center: focus, offset, zoom: Math.max(map.getZoom(), detailZoom), duration: 280 });
    } else if (bounds) {
      map.fitBounds(bounds, { padding, maxZoom: 14, duration: 0 });
    } else if (drafting) {
      map.jumpTo({ center: center || [0, 18], zoom: center ? 11 : 1.5 });
    }
  });
}

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
  const { days, routes, before, open, focusedStop, drafting, center } = pending;
  let focusPoint;
  const points = [], features = [];
  const activePin = document.activeElement?.closest('.map-pin')?.dataset.mapStop;
  for (const { marker } of markers) marker.remove();
  markers = [];
  function pin(stop, p, index, ghost) {
    points.push(p);
    if (stop.id === focusedStop) focusPoint = p;
    const el = document.createElement(open ? 'button' : 'span');
    el.className = 'map-pin' + (ghost ? ' removed' : '');
    if (open) el.type = 'button';
    el.dataset.mapStop = stop.id;
    el.dataset.focused = String(stop.id === focusedStop);
    const number = drafting && Number.isInteger(stop.ordinal) ? stop.ordinal : index + 1;
    el.textContent = ghost ? '−' : String(number);
    el.title = (ghost ? 'นำออก · ' : '') + (stop.name || stop.n) +
      (drafting && stop.place?.source === 'model' ? ' · ตำแหน่งโดยประมาณ' : '');
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
    if (open) el.onclick = (event) => {
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
      if (drafting && stop.place?.fallback) return;
      const p = coordinates(stop.ll),
        a = coordinates(stops[i - 1]?.ll);
      if (p) pin(stop, p, i, false);
      if (!p || !stop.leg) return;
      const mode = stop.leg.mode || stop.leg.m;
      const record = routes?.[stop.leg.key];
      if (drafting && (stops[i - 1]?.place?.fallback || record?.approx || !Array.isArray(record?.geom) || record.geom.length < 2)) return;
      if (!drafting && !a) return;
      const line = segment(a || p, p, record, mode, false, stop.leg.real === false);
      if (drafting && line.properties.approx) return;
      features.push(line);
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
    for (const [stroke, style] of Object.entries(strokes)) {
      const id = 'trip-' + stroke;
      map.addLayer({
        id,
        type: 'line',
        source: 'trip',
        filter: lineFilter(stroke),
        layout: { 'line-cap': style.cap, 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': style.width,
          'line-opacity': style.opacity || 1,
          ...(style.dash && { 'line-dasharray': style.dash }),
        },
      });
      map.on('click', id, (event) => {
        routePopup?.remove();
        routePopup = new library.Popup()
          .setLngLat(event.lngLat)
          .setText(routeLabel(event.features[0].properties) +
            (stroke === 'estimate' || stroke === 'removed' ? '' : ' · ตามถนนจริง'))
          .addTo(map);
      });
    }
  }
  renderLegend(features);
  spreadPins();
  const bounds = points.length && points.reduce((box, p) => box.extend(p), new library.LngLatBounds()).toArray();
  cameraTarget = { bounds, focus: focusPoint, focusedStop, drafting, center };
  scheduleCamera();
}
export function drawMap(days, routes, open, before, focusedStop, draft) {
  const drafting = Boolean(draft), center = coordinates(draft?.cityLL);
  if (draft?.restart || pending?.drafting !== drafting || (!drafting && pending?.days[0] !== days[0])) {
    // MapLibre's worker can still be painting the preceding GeoJSON tiles.
    // Hide that revision immediately while the new source data is being indexed.
    overlayRevision++;
    for (const stroke of Object.keys(strokes)) {
      const id = 'trip-' + stroke;
      if (map?.getLayer(id)) map.setFilter(id, lineFilter(stroke));
    }
    for (const { marker } of markers) marker.remove();
    markers = [];
    routePopup?.remove();
    map?.stop();
    previousCamera = undefined;
    cameraTarget = drafting ? { drafting, center } : null;
    if (map) scheduleCamera();
    renderLegend([]);
  }
  pending = { days, routes, open, before, focusedStop, drafting, center };
  if (map) {
    paint();
    return;
  }
  if (loading || (!draft && !days.some((day) => day?.stops?.length))) return;
  loading = import('/assets/maplibre-gl.mjs?v=6.19.0')
    .then((lib) => {
      library = lib;
      lib.setWorkerUrl('/assets/maplibre-gl-worker.mjs?v=6.19.0');
      const container = document.querySelector('#map');
      container.replaceChildren();
      const dark = matchMedia('(prefers-color-scheme: dark)');
      const style = () => 'https://tiles.openfreemap.org/styles/' + (dark.matches ? 'dark' : 'positron');
      const center = pending.center || coordinates(pending.days.find((day) => day?.stops?.length)?.stops[0]?.ll);
      map = new lib.Map({ container, style: style(), center: center || [0, 18], zoom: center ? 11 : 1.5, scrollZoom: false });
      const sizeChanges = new ResizeObserver(scheduleCamera);
      for (const target of [container, document.querySelector('#place-panel'), document.querySelector('#chat-response')])
        if (target) sizeChanges.observe(target);
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
      loading = null;
      document.querySelector('#map').textContent = 'เปิดแผนที่ไม่สำเร็จ ดูจุดแวะและเส้นทางในกำหนดการได้';
    });
}
