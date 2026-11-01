(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const KEY = "hamburg-route-stops-v2";
  const MAX_STOPS = 20;
  const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
  const OSRM_URL = "https://router.project-osrm.org";
  const DEFAULT_CENTER = [53.5511, 9.9937];

  let stops = loadStops();
  let start = null;
  let markers = [];
  let routeLayer = null;
  let map;
  let routeSequence = 0;
  let routeTimer = null;
  let lastGeocodeAt = 0;
  const geocodeCache = new Map();

  function loadStops() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(s => s && Number.isFinite(+s.lat) && Number.isFinite(+s.lon) && typeof s.query === "string")
        .slice(0, MAX_STOPS)
        .map(s => ({ query: s.query, label: String(s.label || s.query), lat: +s.lat, lon: +s.lon }));
    } catch {
      return [];
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(stops)); }
    catch { message("Speichern nicht möglich. Prüfe den freien Speicherplatz deines Browsers.", true); }
  }

  function message(text, error = false) {
    $("status").textContent = text;
    $("status").style.color = error ? "#c92b25" : "";
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function geocode(query) {
    const cacheKey = query.trim().toLocaleLowerCase("de");
    if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);

    // Nominatim verlangt maximal eine Anfrage pro Sekunde.
    const waitMs = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
    if (waitMs) await wait(waitMs);

    const url = new URL(NOMINATIM_URL);
    url.search = new URLSearchParams({
      format: "jsonv2",
      limit: "1",
      countrycodes: "de",
      q: query
    }).toString();

    const response = await fetch(url, {
      headers: { "Accept-Language": "de" },
      cache: "no-store"
    });
    lastGeocodeAt = Date.now();

    if (response.status === 429) throw new Error("Die Adresssuche ist gerade ausgelastet. Bitte warte kurz und versuche es erneut.");
    if (!response.ok) throw new Error("Adresssuche gerade nicht erreichbar.");
    const results = await response.json();
    if (!results.length) throw new Error("Adresse nicht gefunden. Bitte genauer eingeben.");

    const result = {
      lat: Number(results[0].lat),
      lon: Number(results[0].lon),
      label: results[0].display_name
    };
    geocodeCache.set(cacheKey, result);
    return result;
  }

  async function addStop() {
    const query = $("address").value.trim();
    if (!query) return;
    if (stops.length >= MAX_STOPS) {
      message(`Maximal ${MAX_STOPS} Ziele möglich.`, true);
      return;
    }

    $("add").disabled = true;
    message("Suche Adresse …");
    try {
      const place = await geocode(query);
      const duplicate = stops.some(s =>
        Math.abs(s.lat - place.lat) < 0.00001 && Math.abs(s.lon - place.lon) < 0.00001
      );
      if (duplicate) {
        message("Dieses Ziel ist bereits in deiner Liste.", true);
        return;
      }
      stops.push({ query, lat: place.lat, lon: place.lon, label: place.label });
      $("address").value = "";
      save();
      render();
      message("Ziel hinzugefügt.");
    } catch (error) {
      message(error.message || "Adresssuche fehlgeschlagen.", true);
    } finally {
      $("add").disabled = false;
    }
  }

  function moveStop(index, direction) {
    const next = index + direction;
    if (next < 0 || next >= stops.length) return;
    [stops[index], stops[next]] = [stops[next], stops[index]];
    save();
    render();
  }

  function removeStop(index) {
    stops.splice(index, 1);
    save();
    render();
    message("Ziel entfernt.");
  }

  function renderList() {
    $("count").textContent = `${stops.length}/${MAX_STOPS}`;
    $("stops").innerHTML = stops.map((stop, index) => `
      <li class="stop">
        <span class="num">${index + 1}</span>
        <div class="stoptext">
          <div class="stopname">${escapeHTML(stop.query)}</div>
          <div class="stopmeta">${escapeHTML(stop.label || "")}</div>
        </div>
        <div class="move">
          <button type="button" data-up="${index}" ${index === 0 ? "disabled" : ""} aria-label="Ziel nach oben verschieben">↑</button>
          <button type="button" data-down="${index}" ${index === stops.length - 1 ? "disabled" : ""} aria-label="Ziel nach unten verschieben">↓</button>
        </div>
        <button type="button" class="danger remove" data-del="${index}" aria-label="Ziel löschen">×</button>
      </li>
    `).join("");

    $("stops").querySelectorAll("[data-up]").forEach(button => {
      button.addEventListener("click", () => moveStop(Number(button.dataset.up), -1));
    });
    $("stops").querySelectorAll("[data-down]").forEach(button => {
      button.addEventListener("click", () => moveStop(Number(button.dataset.down), 1));
    });
    $("stops").querySelectorAll("[data-del]").forEach(button => {
      button.addEventListener("click", () => removeStop(Number(button.dataset.del)));
    });

    $("allMaps").disabled = stops.length === 0;
    $("next").disabled = stops.length === 0;
    $("optimize").disabled = stops.length < 3;
  }

  function drawMap() {
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    if (routeLayer) {
      map.removeLayer(routeLayer);
      routeLayer = null;
    }

    const points = [];
    stops.forEach((stop, index) => {
      const marker = L.marker([stop.lat, stop.lon], {
        icon: L.divIcon({
          className: "",
          html: `<div class="route-marker">${index + 1}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(map).bindPopup(`<strong>${index + 1}. ${escapeHTML(stop.query)}</strong>`);
      markers.push(marker);
      points.push([stop.lat, stop.lon]);
    });

    if (start) {
      const marker = L.circleMarker([start.lat, start.lon], {
        radius: 8, color: "#fff", weight: 2, fillColor: "#22a06b", fillOpacity: 1
      }).addTo(map).bindPopup("Start: Mein Standort");
      markers.push(marker);
      points.push([start.lat, start.lon]);
    }

    if (points.length > 1) map.fitBounds(L.latLngBounds(points).pad(0.18));
    else if (points.length === 1) map.setView(points[0], 14);
    else map.setView(DEFAULT_CENTER, 11);
  }

  function routePoints() {
    const points = [];
    if ($("useStart").checked && start) points.push(start);
    stops.forEach(stop => points.push({ lat: stop.lat, lon: stop.lon }));
    return points;
  }

  function scheduleRoute() {
    clearTimeout(routeTimer);
    const sequence = ++routeSequence;
    if (routeLayer) {
      map.removeLayer(routeLayer);
      routeLayer = null;
    }
    $("distance").textContent = "–";
    $("duration").textContent = "–";
    if (routePoints().length < 2) return;

    routeTimer = setTimeout(() => calculateRoute(sequence), 350);
  }

  async function calculateRoute(sequence = ++routeSequence) {
    const points = routePoints();
    if (points.length < 2) return;

    const coordinates = points.map(point => `${point.lon},${point.lat}`).join(";");
    const url = `${OSRM_URL}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Routenserver nicht erreichbar.");
      const data = await response.json();
      if (sequence !== routeSequence) return;
      if (data.code !== "Ok" || !data.routes?.length) throw new Error("Keine passende Route gefunden.");

      const route = data.routes[0];
      routeLayer = L.geoJSON(route.geometry, {
        style: { color: "#087cff", weight: 5, opacity: 0.82, lineCap: "round", lineJoin: "round" }
      }).addTo(map);

      $("distance").textContent = `${(route.distance / 1000).toFixed(1).replace(".", ",")} km`;
      $("duration").textContent = `${Math.round(route.duration / 60)} min`;
    } catch (error) {
      if (sequence !== routeSequence) return;
      $("distance").textContent = "–";
      $("duration").textContent = "–";
      message("Route gerade nicht verfügbar. Die Ziele bleiben gespeichert.", true);
    }
  }

  async function optimizeOrder() {
    if (stops.length < 3) return;
    $("optimize").disabled = true;
    message("Berechne eine kurze Reihenfolge …");

    try {
      const points = routePoints();
      const coordinates = points.map(point => `${point.lon},${point.lat}`).join(";");
      const url = `${OSRM_URL}/table/v1/driving/${coordinates}?annotations=duration`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Optimierungsdienst nicht erreichbar.");
      const data = await response.json();
      if (data.code !== "Ok" || !data.durations) throw new Error("Keine Fahrzeitmatrix erhalten.");

      // Bei gesetztem Standort beginnt die Tour dort. Ohne Standort bleibt Ziel 1 der Start.
      const hasStart = $("useStart").checked && Boolean(start);
      const offset = hasStart ? 1 : 0;
      let current = 0;
      const remaining = stops.map((_, index) => index + offset);
      const order = [];

      if (!hasStart) {
        order.push(0);
        remaining.shift();
        current = 0;
      }

      while (remaining.length) {
        let bestPosition = 0;
        let bestDuration = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const duration = data.durations[current]?.[remaining[i]];
          if (duration !== null && Number.isFinite(duration) && duration < bestDuration) {
            bestDuration = duration;
            bestPosition = i;
          }
        }
        const [nextIndex] = remaining.splice(bestPosition, 1);
        order.push(nextIndex - offset);
        current = nextIndex;
      }

      if (order.length !== stops.length || new Set(order).size !== stops.length) {
        throw new Error("Die Reihenfolge konnte nicht vollständig bestimmt werden.");
      }

      stops = order.map(index => stops[index]);
      save();
      render();
      message("Reihenfolge nach geschätzter Fahrzeit optimiert. Du kannst sie jederzeit manuell ändern.");
    } catch (error) {
      message("Optimierung gerade nicht verfügbar. Bitte später erneut versuchen.", true);
    } finally {
      $("optimize").disabled = stops.length < 3;
    }
  }

  function appleMapsURL(stop, includeStart) {
    let url = `https://maps.apple.com/?daddr=${encodeURIComponent(`${stop.lat},${stop.lon}`)}&dirflg=d`;
    if (includeStart && start && $("useStart").checked) {
      url += `&saddr=${encodeURIComponent(`${start.lat},${start.lon}`)}`;
    }
    return url;
  }

  function openNextStop() {
    if (!stops.length) return;
    window.location.href = appleMapsURL(stops[0], true);
  }

  function openFirstStop() {
    if (!stops.length) return;
    window.location.href = appleMapsURL(stops[0], false);
  }

  function locateUser() {
    if (!navigator.geolocation) {
      message("Standort wird von diesem Browser nicht unterstützt.", true);
      return;
    }
    $("locate").disabled = true;
    message("Standort wird ermittelt …");
    navigator.geolocation.getCurrentPosition(position => {
      start = { lat: position.coords.latitude, lon: position.coords.longitude };
      drawMap();
      scheduleRoute();
      $("locate").disabled = false;
      message("Standort als Startpunkt gesetzt.");
    }, () => {
      $("locate").disabled = false;
      message("Standortzugriff nicht möglich. Bitte in iOS erlauben.", true);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  function render() {
    renderList();
    drawMap();
    scheduleRoute();
  }

  $("add").addEventListener("click", addStop);
  $("address").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      addStop();
    }
  });
  $("locate").addEventListener("click", locateUser);
  $("useStart").addEventListener("change", () => {
    drawMap();
    scheduleRoute();
  });
  $("optimize").addEventListener("click", optimizeOrder);
  $("allMaps").addEventListener("click", openFirstStop);
  $("next").addEventListener("click", openNextStop);
  $("clear").addEventListener("click", () => {
    if (!confirm("Alle gespeicherten Ziele löschen?")) return;
    stops = [];
    save();
    render();
    message("Alle Ziele gelöscht.");
  });

  map = L.map("map", { zoomControl: true }).setView(DEFAULT_CENTER, 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  render();
})();