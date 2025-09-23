// map_eva.js （SVGアイコン版 + 多言語メッセージ対応）

/*
 1. コマンドプロンプトで、「E:\」を入力
 2. cd "E:\2025年度\app_googlemap\map_simulation"
 3. python -m http.server 8000
 4. http://localhost:8000/index.html
 5. 停止は Ctrl+C
*/

// ===== 多言語メッセージ辞書（UIは index.html 側、運用メッセージはここ）=====
let APP_LANG = "ja";
const MSG = {
  ja: {
    noNearby: "700m以内に避難場所がありません。",
    noStartSet: "出発地点が未設定です。地図をタップするか「現在地から避難」を押してください。",
    routeDrawing: "へ経路を表示中…",
    errorPrefix: "エラー: ",
    dirErrorPrefix: "経路描画エラー: ",
    geolocFail: (m)=>`現在地の取得に失敗しました: ${m}`,
    browserNoGeo: "このブラウザは位置情報をサポートしていません。",
    needStartAndDest: "出発地点と目的地を設定してください。"
  },
  en: {
    noNearby: "No shelters within 700 m.",
    noStartSet: "No start point yet. Tap the map or press “Evacuate from current location”.",
    routeDrawing: " showing route…",
    errorPrefix: "Error: ",
    dirErrorPrefix: "Directions error: ",
    geolocFail: (m)=>`Failed to get current location: ${m}`,
    browserNoGeo: "This browser does not support Geolocation.",
    needStartAndDest: "Please set both your start point and destination."
  }
};
function T(key){ return MSG[APP_LANG][key]; }

// 外部（index.html）から言語を切り替えるために公開
window.setAppLanguage = function(lang){
  APP_LANG = (lang === "en") ? "en" : "ja";
};

// ===== グローバル変数 =====
let map;
let directionsService;
let directionsRenderer;
let distanceMatrixService;
let startMarker = null;
let destinations = [];
let latestDestination = null;

// 追加：InfoWindow と 距離・時間の保持
let infoWindow = null;
let lastDistanceMeters = null;
let lastDurationText = null;

// ===== 共通UIメッセージ表示 =====
function displayMessage(message) {
  const el = document.getElementById("nearest-destination");
  if (el) el.textContent = message;
}

// ===== HTMLエスケープ（XSS簡易対策）=====
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== 地図初期化 =====
function initMap() {
  const center = { lat: 41.775271, lng: 140.7257441 };

  map = new google.maps.Map(document.getElementById("map"), {
    zoom: 15,
    center: center,
    clickableIcons: false,
  });

  // 津波浸水想定域（GeoJSON）
  map.data.loadGeoJson("./tsunami.geojson");
  map.data.setStyle({
    fillColor: "#5c9ee7",
    fillOpacity: 0.3,
    strokeColor: "#5c9ee7",
    strokeWeight: 1,
    clickable: false,
  });

  // 経路系サービス初期化
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer();
  directionsRenderer.setMap(map);

  // 距離行列サービス
  distanceMatrixService = new google.maps.DistanceMatrixService();

  // 目的地データ読み込み
  loadDestinations();
  loadEvacPoints();

  // 地図クリックで出発地点を設定
  map.addListener("click", function (event) {
    setStartPoint(event.latLng);
  });
}

// ===== 目的地（避難ビル等）HB.svg =====
function loadDestinations() {
  fetch("./destinations.json")
    .then((response) => response.json())
    .then((data) => {
      destinations = data;
      data.forEach((dest) => {
        addCustomMarker(dest.location, dest.name, "./HB.svg", 34);
      });
    })
    .catch((error) => displayMessage((T('errorPrefix')) + error));
}

// ===== 水平避難ポイント HP.svg（destinationsに統合）=====
function loadEvacPoints() {
  fetch("./evac_points.json")
    .then((response) => response.json())
    .then((data) => {
      data.forEach((point) => {
        const structured = {
          name: point.name,
          location: {
            lat: point.location?.lat ?? point.lat,
            lng: point.location?.lng ?? point.lng,
          },
        };
        destinations.push(structured);
        addCustomMarker(structured.location, structured.name, "./HP.svg", 26);
      });
    })
    .catch((error) => displayMessage((T('errorPrefix')) + error));
}

// ===== マーカー生成（SVG画像表示フル）=====
function addCustomMarker(position, title, iconUrl, sizePx = 32) {
  const scaled = new google.maps.Size(sizePx, sizePx);
  const anchor = new google.maps.Point(sizePx / 2, sizePx / 2);
  const labelOrigin = new google.maps.Point(sizePx / 2, sizePx + 4);

  const marker = new google.maps.Marker({
    position: new google.maps.LatLng(position.lat, position.lng),
    map: map,
    title: title,
    zIndex: 10,
    icon: {
      url: iconUrl,
      scaledSize: scaled, // 全面縮小表示
      anchor: anchor,
      labelOrigin: labelOrigin,
    },
    optimized: false,
  });

  marker.addListener("click", () => {
    openDestinationPopup({ name: title, location: position }, marker);
  });

  return marker;
}

// ===== 目的地ポップアップ（InfoWindow）=====
function openDestinationPopup(dest, marker) {
  latestDestination = dest;
  if (!infoWindow) infoWindow = new google.maps.InfoWindow();

  const linkId = "goto-" + Math.random().toString(36).slice(2);
  const linkText = (APP_LANG === "ja") ? "ここに行く" : "Go here";

  const html = `
    <div style="font-size:14px; line-height:1.5; background:#fff; color:#000; padding:2px 0;">
      <div style="font-weight:600; margin-bottom:6px;">${escapeHtml(dest.name)}</div>
      <a id="${linkId}" href="#" style="color:#007bff; text-decoration:underline;">${linkText}</a>
    </div>
  `;

  infoWindow.setContent(html);
  infoWindow.open(map, marker);

  google.maps.event.addListenerOnce(infoWindow, "domready", () => {
    const el = document.getElementById(linkId);
    if (!el) return;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (!startMarker) {
        displayMessage(T('noStartSet'));
        map.panTo(marker.getPosition());
        return;
      }
      const origin = startMarker.getPosition();
      drawRoute(origin, dest.location);
    });
  });
}

// ===== 出発地点の設定 =====
function setStartPoint(location) {
  if (startMarker) startMarker.setMap(null);
  startMarker = new google.maps.Marker({
    position: location,
    map: map,
    title: (APP_LANG === "ja") ? "スタート地点" : "Start point",
  });
  findClosestPoint(location);
}

// ===== 最近傍の避難先を探索（半径700m）=====
function findClosestPoint(origin) {
  function getDistanceInMeters(loc1, loc2) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(loc2.lat - loc1.lat);
    const dLng = toRad(loc2.lng - loc1.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(loc1.lat)) *
        Math.cos(toRad(loc2.lat)) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  const nearbyDestinations = destinations.filter((dest) => {
    const distance = getDistanceInMeters(
      { lat: origin.lat(), lng: origin.lng() },
      { lat: dest.location.lat, lng: dest.location.lng }
    );
    return distance <= 700;
  });

  if (nearbyDestinations.length === 0) {
    displayMessage(T('noNearby'));
    directionsRenderer.setDirections({ routes: [] });
    lastDistanceMeters = null;
    lastDurationText = null;
    latestDestination = null;
    return;
  }

  const destinationLocations = nearbyDestinations.map((dest) => dest.location);

  distanceMatrixService.getDistanceMatrix(
    {
      origins: [origin],
      destinations: destinationLocations,
      travelMode: google.maps.TravelMode.WALKING,
    },
    function (response, status) {
      if (status === google.maps.DistanceMatrixStatus.OK) {
        const distances = response.rows[0].elements;
        let closestIndex = 0;
        let minDistance = distances[0].distance.value;

        for (let i = 1; i < distances.length; i++) {
          if (distances[i].distance.value < minDistance) {
            minDistance = distances[i].distance.value;
            closestIndex = i;
          }
        }

        latestDestination = nearbyDestinations[closestIndex];
        lastDistanceMeters = distances[closestIndex].distance.value;
        lastDurationText  = distances[closestIndex].duration.text;

        const summary = (APP_LANG === "ja")
          ? `${latestDestination.name}（${lastDistanceMeters} m、約 ${lastDurationText}）`
          : `${latestDestination.name} (${lastDistanceMeters} m, about ${lastDurationText})`;

        displayMessage(summary);
        drawRoute(origin, latestDestination.location);
      } else {
        displayMessage(T('errorPrefix') + status);
      }
    }
  );
}

// ===== 経路描画 =====
function drawRoute(origin, destination) {
  directionsService.route(
    {
      origin: origin,
      destination: destination,
      travelMode: google.maps.TravelMode.WALKING,
    },
    function (result, status) {
      if (status === google.maps.DirectionsStatus.OK) {
        directionsRenderer.setDirections(result);
        if (latestDestination && lastDistanceMeters != null && lastDurationText != null) {
          const summary = (APP_LANG === "ja")
            ? `${latestDestination.name}（${lastDistanceMeters} m、約 ${lastDurationText}）`
            : `${latestDestination.name} (${lastDistanceMeters} m, about ${lastDurationText})`;
          displayMessage(summary);
        } else if (latestDestination) {
          const msg = (APP_LANG === "ja")
            ? `${latestDestination.name} ${T('routeDrawing')}`
            : `${latestDestination.name}${T('routeDrawing')}`;
          displayMessage(msg);
        }
      } else {
        displayMessage(T('dirErrorPrefix') + status);
      }
    }
  );
}

// ===== Googleマップ（別タブ）で開く =====
function openInGoogleMaps(origin, destination) {
  const url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=walking`;
  window.open(url, "_blank");
}

function launchGoogleMap() {
  if (!startMarker || !latestDestination) {
    displayMessage(T('needStartAndDest'));
    return;
  }
  const origin = startMarker.getPosition();
  openInGoogleMaps(
    { lat: origin.lat(), lng: origin.lng() },
    latestDestination.location
  );
}

// ===== 現在地から避難 =====
function useCurrentLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function (position) {
        const latLng = new google.maps.LatLng(
          position.coords.latitude,
          position.coords.longitude
        );
        setStartPoint(latLng);
      },
      function (error) {
        displayMessage(MSG[APP_LANG].geolocFail(error.message));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  } else {
    displayMessage(T('browserNoGeo'));
  }
}

// Google Maps の callback から参照できるように公開
window.initMap = initMap;
window.useCurrentLocation = useCurrentLocation;
window.launchGoogleMap = launchGoogleMap;
