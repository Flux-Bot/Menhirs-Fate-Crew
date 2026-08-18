const latitude = projectData[0].latitude;
const longitude = projectData[0].longitude;
const zoom = projectData[0].map_zoom;
const tentLayersById = {};

let map = null;

// UI / interaction state
let showUnplacedOnly = false;           // when true, sidebar shows only tents without lat/lng
let lastMouseLatLng = null;             // latest mouse position while placing a tent
let tentRotateGhost = null;             // temporary ghost shown while rotating an existing tent


const mapContainer = document.getElementById('map');
if (!mapContainer) {
    // No map element on the page — exit early to avoid errors when this file is included on other pages
    console.warn('map.js: no #map element found; aborting map initialization');
    window.map = null;
} else {
    map = L.map('map').setView([
        latitude, longitude
    ], zoom);

    // expose map for public template helpers
    window.map = map;

    mapContainer.style.touchAction = 'none';

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
}

if (map) {

    // Create dedicated pane for area polygons so they render behind tents
    map.createPane('areasPane');
    // choose zIndex lower than overlay pane so tents (in overlay pane) remain visible above areas
    map.getPane('areasPane').style.zIndex = 300;
    // allow pointer events for area labels if needed
    map.getPane('areasPane').style.pointerEvents = 'auto';

    const areasLayerGroup = L.layerGroup().addTo(map);
    let drawingArea = null; // { name, points: [], markers: [], previewLine, previewPolygon }
    let selectedArea = null; // { area_id, name, points, color }
    let selectedAreaLayer = null; // Leaflet layer for currently selected area

    const areaColors = {
        Avereaux: '#ffadad',
        Wonder: '#ffd6a5',
        Valdraeth: '#fdffb6',
        Urdrevan: '#caffbf',
        Portavas: '#9bf6ff',
        Hammerstadt: '#a0c4ff',
        Kairos: '#bdb2ff',
        Syradonia: '#ffc6ff',
        Morvalis: '#d3f8e2',
        Crew: '#e0e0e0',
        Guilds: '#f1c0e8',
        Traders: '#f9f871',
        Unassigned: '#ffffff80'
    };

    // Initialize areasData from server-passed data (areasFromDb) if available
    let areasData = [];
    try {
        if (window.areasFromDb && Array.isArray(window.areasFromDb)) {
            areasData = window.areasFromDb.map(r => {
                const coords = (r.geojson && r.geojson.coordinates && r.geojson.coordinates[0]) || [];
                const points = coords.map(c => [c[1], c[0]]); // [lng,lat] -> [lat,lng]
                return {
                    area_id: r.area_id || r.id || null,
                    name: r.area_name || r.name || 'Unassigned',
                    points,
                    color: r.color || areaColors[r.area_name] || null
                };
            });
        }
    } catch (e) {
        console.warn('Failed to parse areasFromDb', e);
        areasData = [];
    }

    function setSelectedArea(a, layer) {
        // clear prior selection style
        if (selectedAreaLayer) {
            try {
                selectedAreaLayer.setStyle({ weight: 2, fillOpacity: 0.35 });
            } catch (e) {}
        }
        selectedArea = a ? { area_id: a.area_id, name: a.name } : null;
        selectedAreaLayer = layer || null;
        if (selectedAreaLayer) {
            try { selectedAreaLayer.setStyle({ weight: 4, fillOpacity: 0.6 }); } catch (e) {}
        }
        const delBtn = document.getElementById('deleteSelectedArea');
        if (delBtn) delBtn.disabled = selectedArea === null;
    }

    function renderAllAreas() {
        areasLayerGroup.clearLayers();
        const legend = document.getElementById('areasLegend');
        if (legend) legend.innerHTML = '';

        areasData.forEach(a => {
            try {
                const fill = a.color || areaColors[a.name] || '#888';
                const poly = L.polygon(a.points, {
                    color: fill,
                    fillColor: fill,
                    fillOpacity: 0.35,
                    weight: 2,
                    pane: 'areasPane'
                }).addTo(areasLayerGroup);
                poly.areaName = a.name;

                const center = poly.getBounds().getCenter();
                const label = L.marker(center, {
                    icon: L.divIcon({
                        className: 'area-label',
                        html: `<div style="background: rgba(255,255,255,0.85); padding:2px 6px; border-radius:4px; font-weight:600;">${a.name}</div>`
                    }),
                    interactive: false,
                    pane: 'areasPane'
                }).addTo(areasLayerGroup);
                poly.label = label;

                // clicking a polygon selects it for deletion/editing
                poly.on('click', function (e) {
                    setSelectedArea(a, poly);
                });

                // Add to legend (clicking swatch also selects)
                if (legend) {
                    const swatch = document.createElement('div');
                    swatch.style.display = 'inline-block';
                    swatch.style.marginRight = '8px';
                    swatch.style.cursor = 'pointer';
                    swatch.innerHTML = `<span style="display:inline-block;width:16px;height:12px;background:${fill};border:1px solid #444;margin-right:6px;"></span>${a.name}`;
                    swatch.addEventListener('click', function () { setSelectedArea(a, poly); });
                    legend.appendChild(swatch);
                }

                // If this area was previously selected, restore highlight
                if (selectedArea && selectedArea.area_id && a.area_id === selectedArea.area_id) {
                    setSelectedArea(a, poly);
                }
            } catch (e) {
                console.warn('Failed to render area', a, e);
            }
        });
    }

    renderAllAreas();

    function startAreaDraw() {
        const selectEl = document.getElementById('AreaNameForDraw');
        const name = selectEl ? selectEl.value : null;
        if (!name) {
            alert('Choose an area name to draw.');
            return;
        }
        if (drawingArea) {
            alert('Finish or cancel the active drawing first.');
            return;
        }
        drawingArea = { name, points: [], markers: [], previewLine: null, previewPolygon: null };
        document.getElementById('startAreaDraw').disabled = true;
        document.getElementById('finishAreaDraw').disabled = false;
        document.getElementById('cancelAreaDraw').disabled = false;
        // give visual hint
        map.getContainer().style.cursor = 'crosshair';
    }

    function addAreaPoint(latlng) {
        if (!drawingArea) return;
        drawingArea.points.push([latlng.lat, latlng.lng]);
        const m = L.circleMarker(latlng, { radius: 4, color: '#000', fillColor: '#fff', weight:1, pane: 'areasPane' }).addTo(map);
        drawingArea.markers.push(m);
        updateAreaPreview();
    }

    function updateAreaPreview() {
        if (!drawingArea) return;
        // remove old previews
        try { if (drawingArea.previewLine) map.removeLayer(drawingArea.previewLine); } catch (e) {}
        try { if (drawingArea.previewPolygon) map.removeLayer(drawingArea.previewPolygon); } catch (e) {}

        if (drawingArea.points.length === 0) return;

        drawingArea.previewLine = L.polyline(drawingArea.points, { color: areaColors[drawingArea.name] || '#888', dashArray: '6,4', pane: 'areasPane' }).addTo(map);

        if (drawingArea.points.length >= 3) {
            drawingArea.previewPolygon = L.polygon(drawingArea.points, { color: areaColors[drawingArea.name] || '#888', fillColor: areaColors[drawingArea.name] || '#888', fillOpacity: 0.25, pane: 'areasPane' }).addTo(map);
        }
    }

    function finishAreaDraw() {
        if (!drawingArea) return;
        if (drawingArea.points.length < 3) {
            alert('At least three points are required to make an area.');
            return;
        }

        // Build GeoJSON (ensure ring is closed and coords are [lng, lat])
        const coords = drawingArea.points.map(p => [p[1], p[0]]);
        if (coords.length && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
            coords.push(coords[0]);
        }
        const geojson = { type: 'Polygon', coordinates: [coords] };

        // POST to server
        fetch('/api/areas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: projectData[0].project_id,
                area_name: drawingArea.name,
                geojson: geojson,
                color: areaColors[drawingArea.name] || null
            })
        }).then(r => r.json())
        .then(resp => {
            if (resp && resp.error) {
                alert('Failed to save area: ' + resp.error);
                return;
            }

            // server returned saved row
            const newRow = resp;
            const newArea = {
                area_id: newRow.get ? newRow.get('area_id') : (newRow.area_id || newRow.id || null),
                name: newRow.area_name || newRow.name || drawingArea.name,
                points: drawingArea.points.slice(),
                color: newRow.color || areaColors[drawingArea.name] || null
            };

            areasData.push(newArea);

            // cleanup preview markers & lines
            drawingArea.markers.forEach(m => { try { map.removeLayer(m); } catch (e) {} });
            try { if (drawingArea.previewLine) map.removeLayer(drawingArea.previewLine); } catch (e) {}
            try { if (drawingArea.previewPolygon) map.removeLayer(drawingArea.previewPolygon); } catch (e) {}
            drawingArea = null;
            renderAllAreas();
            document.getElementById('startAreaDraw').disabled = false;
            document.getElementById('finishAreaDraw').disabled = true;
            document.getElementById('cancelAreaDraw').disabled = true;
            map.getContainer().style.cursor = '';
        }).catch(err => {
            console.error('Failed to save area', err);
            alert('Failed to save area');
        });
    }

    function cancelAreaDraw() {
        if (!drawingArea) return;
        drawingArea.markers.forEach(m => { try { map.removeLayer(m); } catch (e) {} });
        try { if (drawingArea.previewLine) map.removeLayer(drawingArea.previewLine); } catch (e) {}
        try { if (drawingArea.previewPolygon) map.removeLayer(drawingArea.previewPolygon); } catch (e) {}
        drawingArea = null;
        document.getElementById('startAreaDraw').disabled = false;
        document.getElementById('finishAreaDraw').disabled = true;
        document.getElementById('cancelAreaDraw').disabled = true;
        map.getContainer().style.cursor = '';
    }

    function deleteSelectedArea() {
        if (!selectedArea || !selectedArea.area_id) {
            alert('Select an area to delete');
            return;
        }
        if (!confirm(`Delete area "${selectedArea.name}"? This cannot be undone.`)) return;

        fetch(`/api/areas/${selectedArea.area_id}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(resp => {
            if (resp && resp.error) {
                alert('Failed to delete area: ' + resp.error);
                return;
            }
            // remove from client list
            areasData = areasData.filter(a => a.area_id !== selectedArea.area_id);
            // clear selection
            setSelectedArea(null, null);
            renderAllAreas();
        }).catch(err => {
            console.error('Failed to delete area', err);
            alert('Failed to delete area');
        });
    }

    map.on('click', function(e) {
        // if currently drawing an area, capture points
        if (drawingArea) {
            addAreaPoint(e.latlng);
            return;
        }
    });

    // wire up buttons
    setTimeout(() => {
        const startBtn = document.getElementById('startAreaDraw');
        const finishBtn = document.getElementById('finishAreaDraw');
        const cancelBtn = document.getElementById('cancelAreaDraw');
        const deleteBtn = document.getElementById('deleteSelectedArea');
        if (startBtn) startBtn.addEventListener('click', startAreaDraw);
        if (finishBtn) finishBtn.addEventListener('click', finishAreaDraw);
        if (cancelBtn) cancelBtn.addEventListener('click', cancelAreaDraw);
        if (deleteBtn) deleteBtn.addEventListener('click', deleteSelectedArea);
        // ensure delete button disabled initially
        if (deleteBtn && !selectedArea) deleteBtn.disabled = true;
    }, 200);





    tentDataFromDb.forEach(tent => {

    if (
        tent.latitude == null ||
        tent.longitude == null ||
        isNaN(tent.latitude) ||
        isNaN(tent.longitude)
    ) {
        return;
    }

    let tentLayer;

    if (tent.bell_size && tent.bell_size > 0) {

        tentLayer = L.circle(
            [tent.latitude, tent.longitude],
            {
                radius: tent.bell_size / 2,
                color: 'green',
                fillOpacity: 0.4
            }
        );

    } else {

        tentLayer = createTentPolygon(
            {
                lat: tent.latitude,
                lng: tent.longitude
            },
            tent.length,
            tent.width,
            tent.rotation,
            false
        );
    }

    tentLayer.tentData = {
        id: tent.object_id,
        group_name: tent.group_name,
        area: tent.nation,
        bell_size: tent.bell_size,
        length: tent.length,
        width: tent.width,
        rotation: tent.rotation
    };
    tentLayersById[tent.object_id] = tentLayer;

    tentLayer.addTo(map);

    const center = tentLayer.getBounds().getCenter();

    const textMarker = L.marker(center, {
        icon: L.divIcon({
            className: 'tent-text',
            html: `${tent.group_name}`
        }),
        interactive: true
    }).addTo(map);

    tentLayer.textMarker = textMarker;

    makeTentDraggable(tentLayer);
});



//Test
let placingTent = false;
let ghostTent = null;
let tentData = null;
let selectedTent = null;
let activeTentDrag = null;
let tentDragGhost = null;
let pendingTentMove = null;

function getTentDefaultStyle(tentLayer) {
    const usesBell = tentLayer && tentLayer.tentData
        && !isNaN(tentLayer.tentData.bell_size)
        && tentLayer.tentData.bell_size > 0;

    return usesBell
        ? {
            color: 'green',
            fillOpacity: 0.4,
            weight: 1,
            dashArray: null
        }
        : {
            color: 'green',
            fillOpacity: 0.4,
            weight: 2,
            dashArray: null
        };
}

function updateTentSelectionHighlight(tentLayer, isSelected) {
    if (!tentLayer || typeof tentLayer.setStyle !== 'function') {
        return;
    }

    const baseStyle = getTentDefaultStyle(tentLayer);

    if (isSelected) {
        tentLayer.setStyle({
            ...baseStyle,
            color: 'yellow',
            fillOpacity: 0.6,
            weight: baseStyle.weight + 1
        });
        return;
    }

    tentLayer.setStyle(baseStyle);
}

function getTentLayerAtPosition(center, tentInfo, ghost = false) {
    if (!isNaN(tentInfo.bell_size) && tentInfo.bell_size > 0) {
        return L.circle(center, {
            radius: tentInfo.bell_size / 2,
            color: ghost ? '#3388ff' : 'green',
            weight: ghost ? 2 : 1,
            dashArray: ghost ? '5,5' : null,
            fillOpacity: ghost ? 0.2 : 0.4
        });
    }

    return createTentPolygon(
        center,
        tentInfo.length,
        tentInfo.width,
        tentInfo.rotation,
        ghost
    );
}

function clearTentDragGhost() {
    if (tentDragGhost) {
        map.removeLayer(tentDragGhost);
        tentDragGhost = null;
    }
}

function beginTentDrag(tentLayer, event) {
    if (placingTent || !tentLayer || !tentLayer.tentData) {
        return;
    }

    if (event && event.originalEvent) {
        L.DomEvent.stopPropagation(event);
        L.DomEvent.preventDefault(event);
    }

    const startLatLng = event && event.latlng
        ? event.latlng
        : (event && event.target && event.target.getLatLng ? event.target.getLatLng() : tentLayer.getBounds().getCenter());

    if (selectedTent && selectedTent !== tentLayer) {
        updateTentSelectionHighlight(selectedTent, false);
    }

    selectedTent = tentLayer;
    updateTentSelectionHighlight(tentLayer, false);
    populateTentForm(tentLayer.tentData);
    activeTentDrag = tentLayer;
    pendingTentMove = null;
    clearTentDragGhost();
    updateTentDragGhost(startLatLng, event);

    map.dragging.disable();
    map.touchZoom.disable();
    map.doubleClickZoom.disable();
    map.scrollWheelZoom.disable();
    map.boxZoom.disable();
}

function selectTentForForm(tentLayer, event) {
    if (!tentLayer || !tentLayer.tentData) {
        return;
    }

    if (selectedTent && selectedTent !== tentLayer) {
        selectedTent.moveReadyForMove = false;
        updateTentSelectionHighlight(selectedTent, false);
    }

    if (selectedTent === tentLayer && tentLayer.moveReadyForMove) {
        tentLayer.moveReadyForMove = false;
        updateTentSelectionHighlight(tentLayer, false);
        beginTentDrag(tentLayer, event);
        return;
    }

    if (selectedTent === tentLayer) {
        updateTentSelectionHighlight(tentLayer, false);
        selectedTent = null;
        tentLayer.moveReadyForMove = false;
        pendingTentMove = null;
        populateTentForm(tentLayer.tentData);
    } else {
        selectedTent = tentLayer;
        tentLayer.moveReadyForMove = true;
        pendingTentMove = tentLayer;
        updateTentSelectionHighlight(tentLayer, true);
        populateTentForm(tentLayer.tentData);
    }

    if (event && event.originalEvent) {
        L.DomEvent.stopPropagation(event);
        L.DomEvent.preventDefault(event);
    }
}

function updateTentDragGhost(latlng, event) {
    if (!activeTentDrag || !latlng) {
        return;
    }

    if (event && event.originalEvent) {
        L.DomEvent.stopPropagation(event);
        L.DomEvent.preventDefault(event);
    }

    clearTentDragGhost();
    tentDragGhost = getTentLayerAtPosition(latlng, activeTentDrag.tentData, true);
    tentDragGhost.addTo(map);
}

function finishTentDrag(latlng, event) {
    if (!activeTentDrag) {
        return;
    }

    if (event && event.originalEvent) {
        L.DomEvent.stopPropagation(event);
        L.DomEvent.preventDefault(event);
    }

    const finalLatLng = latlng || activeTentDrag.getBounds().getCenter();

    clearTentDragGhost();
    const movedTent = moveTentToPosition(activeTentDrag, finalLatLng);
    updateTentInDatabase(movedTent);
    activeTentDrag = null;
    pendingTentMove = null;

    map.dragging.enable();
    map.touchZoom.enable();
    map.doubleClickZoom.enable();
    map.scrollWheelZoom.enable();
    map.boxZoom.enable();
}

map.on('mousemove', function (e) {
    if (!activeTentDrag) {
        return;
    }

    updateTentDragGhost(e.latlng, e);
});

map.on('mouseup', function (e) {
    finishTentDrag(e.latlng, e);
});

map.on('touchmove', function (e) {
    if (!activeTentDrag) {
        return;
    }

    updateTentDragGhost(e.latlng, e);
});

map.on('touchend', function (e) {
    finishTentDrag(e.latlng, e);
});

map.on('touchcancel', function (e) {
    finishTentDrag(e.latlng, e);
});

// Public / read-only safety: if the page sets window.PUBLIC_VIEW = true the map should be read-only.
const PUBLIC_VIEW = window.PUBLIC_VIEW === true;

const addBtn = document.getElementById("addTentBtn");
if (addBtn && !PUBLIC_VIEW) {
    addBtn.addEventListener("click", function () {

    const bellSize = parseFloat(document.getElementById("Bell_Size").value);
    const length = parseFloat(document.getElementById("Tent_Length").value);
    const width = parseFloat(document.getElementById("Tent_Width").value);

    tentData = {
    group_name: document.getElementById("Group_Name").value,
    area: document.getElementById("Area").value,
    bell_size: parseFloat(document.getElementById("Bell_Size").value),
    length: parseFloat(document.getElementById("Tent_Length").value),
    width: parseFloat(document.getElementById("Tent_Width").value),
    rotation: parseFloat(document.getElementById("Tent_Rotation").value) || 0
    };

    placingTent = true;
    });
}

map.on('mousemove', function(e) {

    if (!placingTent) return;

    // remember last mouse position while placing so other UI (rotation) can update the ghost
    lastMouseLatLng = e.latlng;

    if (ghostTent) {
        map.removeLayer(ghostTent);
    }

    if (!isNaN(tentData.bell_size) && tentData.bell_size > 0) {

        ghostTent = L.circle(e.latlng, {
            radius: tentData.bell_size / 2,
            color: '#3388ff',
            weight: 2,
            dashArray: '5,5',
            fillOpacity: 0.2
        });

    } else {

        ghostTent = createTentPolygon(
            e.latlng,
            tentData.length,
            tentData.width,
            tentData.rotation,
            true
        );

    }

    ghostTent.addTo(map);
});

function createTentPolygon(center, length, width, rotation, ghost = false) {

    const lat = center.lat;
    const lng = center.lng;

    const halfLength = length / 2;
    const halfWidth = width / 2;

    const angle = rotation * Math.PI / 180;

    const corners = [
        [-halfWidth, -halfLength],
        [ halfWidth, -halfLength],
        [ halfWidth,  halfLength],
        [-halfWidth,  halfLength]
    ];

    const points = corners.map(([x, y]) => {

        const rx = x * Math.cos(angle) - y * Math.sin(angle);
        const ry = x * Math.sin(angle) + y * Math.cos(angle);

        const pointLat =
            lat + (ry / 111320);

        const pointLng =
            lng + (rx / (111320 * Math.cos(lat * Math.PI / 180)));

        return [pointLat, pointLng];
    });

    return L.polygon(points, {
        color: ghost ? '#3388ff' : 'green',
        weight: 2,
        dashArray: ghost ? '5,5' : null,
        fillOpacity: ghost ? 0.2 : 0.4
    });
}


map.on('click', function(e) {

    if (!placingTent) return;

    placingTent = false;

    if (ghostTent) {
        map.removeLayer(ghostTent);
    }

    let tentLayer;

    if (!isNaN(tentData.bell_size) && tentData.bell_size > 0) {

        tentLayer = L.circle(e.latlng, {
            radius: tentData.bell_size / 2,
            color: 'green',
            fillOpacity: 0.4
        });

    } else {

        tentLayer = createTentPolygon(
            e.latlng,
            tentData.length,
            tentData.width,
            tentData.rotation,
            false
        );

    }

    tentLayer.tentData = {
        id: null,
        group_name: tentData.group_name,
        area: tentData.area,
        bell_size: tentData.bell_size,
        length: tentData.length,
        width: tentData.width,
        rotation: tentData.rotation
    };

    if (selectedTent && selectedTent !== tentLayer) {
        updateTentSelectionHighlight(selectedTent, false);
    }

    tentLayer.addTo(map);
    makeTentDraggable(tentLayer);

    //a
    const center = tentLayer.getBounds().getCenter();

    const textMarker = L.marker(center, {
        icon: L.divIcon({
            className: 'tent-text',
            html: `<div>${tentData.group_name}</div>`
        }),
        interactive: true
    }).addTo(map);

    tentLayer.textMarker = textMarker;

    selectedTent = tentLayer;
    tentLayer.moveReadyForMove = false;
    updateTentSelectionHighlight(tentLayer, true);
    populateTentForm(tentLayer.tentData);

    if (existingTentBeingPlaced) {

    fetch('/update_tent', {

        method: 'POST',

        headers: {
            'Content-Type': 'application/json'
        },

        body: JSON.stringify({

            object_id:
                existingTentBeingPlaced.object_id,

            group_name:
                existingTentBeingPlaced.group_name,

            area:
                existingTentBeingPlaced.nation,

            latitude: e.latlng.lat,

            longitude: e.latlng.lng,

            bell_size:
                existingTentBeingPlaced.bell_size,

            length:
                existingTentBeingPlaced.length,

            width:
                existingTentBeingPlaced.width,

            rotation:
                existingTentBeingPlaced.rotation
        })
    });

    tentLayer.tentData.id =
        existingTentBeingPlaced.object_id;

    tentLayersById[
        existingTentBeingPlaced.object_id
    ] = tentLayer;

    existingTentBeingPlaced.latitude =
        e.latlng.lat;

    existingTentBeingPlaced.longitude =
        e.latlng.lng;

    existingTentBeingPlaced = null;

    buildTentSidebar(
        document.getElementById("tentSearch")?.value || ""
    );
}
else {

    fetch('/add_tent', {

        method: 'POST',

        headers: {
            'Content-Type': 'application/json'
        },

        body: JSON.stringify({
            project_id: projectData[0].project_id,
            group_name: tentData.group_name,
            area: tentData.area,
            latitude: e.latlng.lat,
            longitude: e.latlng.lng,
            bell_size: tentData.bell_size,
            length: tentData.length,
            width: tentData.width,
            rotation: tentData.rotation
        })
    })
    .then(response => response.json())
    .then(data => {

        tentLayer.tentData.id = data.id;

        tentLayersById[data.id] = tentLayer;

        // Add new tent to local dataset
        tentDataFromDb.push({
            object_id: data.id,
            project_id: projectData[0].project_id,
            group_name: tentData.group_name,
            nation: tentData.area,
            latitude: e.latlng.lat,
            longitude: e.latlng.lng,
            bell_size: tentData.bell_size,
            length: tentData.length,
            width: tentData.width,
            rotation: tentData.rotation
        });

        // Refresh sidebar
        buildTentSidebar(
            document.getElementById("tentSearch")?.value || ""
        );
    });
}
});

function populateTentForm(tent) {
    document.getElementById("Group_Name").value = tent.group_name || "";
    document.getElementById("Area").value = tent.area || "";
    document.getElementById("Bell_Size").value = tent.bell_size || "";
    document.getElementById("Tent_Length").value = tent.length || "";
    document.getElementById("Tent_Width").value = tent.width || "";
    document.getElementById("Tent_Rotation").value = tent.rotation || 0;
}


const updateBtn = document.getElementById("updateTentBtn");
if (updateBtn && !PUBLIC_VIEW) {
    updateBtn.addEventListener("click", function () {

    if (!selectedTent) {
        alert("Select a tent first");
        return;
    }

    const groupName =
        document.getElementById("Group_Name").value;

    const area =
        document.getElementById("Area").value;

    const bellSize =
        parseFloat(document.getElementById("Bell_Size").value);

    const length =
        parseFloat(document.getElementById("Tent_Length").value);

    const width =
        parseFloat(document.getElementById("Tent_Width").value);

    const rotation =
        parseFloat(document.getElementById("Tent_Rotation").value);

    selectedTent.tentData.group_name = groupName;
    selectedTent.tentData.area = area;
    selectedTent.tentData.bell_size = bellSize;
    selectedTent.tentData.length = length;
    selectedTent.tentData.width = width;
    selectedTent.tentData.rotation = rotation;

    redrawSelectedTent();

    updateTentInDatabase(selectedTent);
    // remove any temporary rotation ghost now that changes are persisted
    clearTentRotateGhost();

        const tentRecord = tentDataFromDb.find(
        t => t.object_id === selectedTent.tentData.id
    );

    if (tentRecord) {
        tentRecord.group_name = selectedTent.tentData.group_name;
        tentRecord.nation = selectedTent.tentData.area;
    }

    buildTentSidebar(
        document.getElementById("tentSearch")?.value || ""
    );
});
}

const deleteBtn = document.getElementById("deleteTentBtn");
if (deleteBtn && !PUBLIC_VIEW) {
    deleteBtn.addEventListener("click", function () {
    if (!selectedTent || !selectedTent.tentData || !selectedTent.tentData.id) {
        alert("Select a tent first");
        return;
    }

    if (!confirm("Please confirm you want to delete this tent from the map?")) {
        return;
    }

    deleteTentFromDatabase(selectedTent);
    });
}

function updateTentInDatabase(tentLayer) {

    const center = tentLayer.centerPoint
        ? tentLayer.centerPoint
        : tentLayer.getBounds().getCenter();

    fetch('/update_tent', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            object_id: tentLayer.tentData.id,
            group_name: tentLayer.tentData.group_name,
            area: tentLayer.tentData.area,
            latitude: center.lat,
            longitude: center.lng,
            bell_size: tentLayer.tentData.bell_size,
            length: tentLayer.tentData.length,
            width: tentLayer.tentData.width,
            rotation: tentLayer.tentData.rotation
        })
    });
}

function deleteTentFromDatabase(tentLayer) {
    fetch('/delete_tent', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            object_id: tentLayer.tentData.id
        })
    })
    .then(() => {
        if (tentLayer.textMarker) {
            map.removeLayer(tentLayer.textMarker);
        }

        map.removeLayer(tentLayer);
        updateTentSelectionHighlight(tentLayer, false);

        if (selectedTent === tentLayer) {
            selectedTent = null;
        }

        const index = tentDataFromDb.findIndex(
            t => t.object_id === tentLayer.tentData.id
        );

        if (index !== -1) {
            tentDataFromDb.splice(index, 1);
        }

        // clear any temporary rotation ghost
        clearTentRotateGhost();

        buildTentSidebar(
            document.getElementById("tentSearch")?.value || ""
        );


        populateTentForm({
            group_name: '',
            area: '',
            bell_size: '',
            length: '',
            width: '',
            rotation: 0
        });
    });
}

function populateTentForm(tent) {

    document.getElementById("Group_Name").value = tent.group_name || "";
    document.getElementById("Area").value = tent.area || "";
    document.getElementById("Bell_Size").value = tent.bell_size || "";
    document.getElementById("Tent_Length").value = tent.length || "";
    document.getElementById("Tent_Width").value = tent.width || "";
    document.getElementById("Tent_Rotation").value = tent.rotation || 0;

    document.querySelector("#Tent_Rotation + output").value =
        tent.rotation || 0;
}

function redrawSelectedTent() {

    // remove any temporary rotate ghost before redrawing
    clearTentRotateGhost();

    const center = selectedTent.getBounds().getCenter();

    map.removeLayer(selectedTent);

    if (selectedTent.textMarker) {
        map.removeLayer(selectedTent.textMarker);
    }

    let newTent;

    if (
        !isNaN(selectedTent.tentData.bell_size) &&
        selectedTent.tentData.bell_size > 0
    ) {

        newTent = L.circle(center, {
            radius: selectedTent.tentData.bell_size / 2,
            color: 'green',
            fillOpacity: 0.4
        });

    } else {

        newTent = createTentPolygon(
            center,
            selectedTent.tentData.length,
            selectedTent.tentData.width,
            selectedTent.tentData.rotation,
            false
        );
    }

    newTent.tentData = selectedTent.tentData;

    newTent.addTo(map);

    const textMarker = L.marker(center, {
        icon: L.divIcon({
            className: 'tent-text',
            html: selectedTent.tentData.group_name
        }),
        interactive: true
    }).addTo(map);

    newTent.textMarker = textMarker;

    selectedTent = newTent;
    updateTentSelectionHighlight(newTent, true);
}

function makeTentDraggable(tentLayer) {
    tentLayer.on('click', function (e) {
        if (placingTent) {
            return;
        }

        if (L.Browser.touch) {
            selectTentForForm(tentLayer, e);
            return;
        }

        selectTentForForm(tentLayer, e);
    });

    tentLayer.on('touchend', function (e) {
        if (placingTent) {
            return;
        }

        selectTentForForm(tentLayer, e);
    });

    if (tentLayer.textMarker) {
        tentLayer.textMarker.on('click', function (e) {
            if (placingTent) {
                return;
            }

            selectTentForForm(tentLayer, e);
        });

        tentLayer.textMarker.on('touchend', function (e) {
            if (placingTent) {
                return;
            }

            selectTentForForm(tentLayer, e);
        });
    }
}

function moveTentToPosition(tentLayer, newCenter) {

    map.removeLayer(tentLayer);

    if (tentLayer.textMarker) {
        map.removeLayer(tentLayer.textMarker);
    }

    let newTent;

    if (
        !isNaN(tentLayer.tentData.bell_size) &&
        tentLayer.tentData.bell_size > 0
    ) {

        newTent = L.circle(newCenter, {
            radius: tentLayer.tentData.bell_size / 2,
            color: 'green',
            fillOpacity: 0.4
        });

    } else {

        newTent = createTentPolygon(
            newCenter,
            tentLayer.tentData.length,
            tentLayer.tentData.width,
            tentLayer.tentData.rotation
        );
    }

    newTent.tentData = tentLayer.tentData;
    newTent.centerPoint = newCenter;

    newTent.addTo(map);

    const textMarker = L.marker(newCenter, {
        icon: L.divIcon({
            className: 'tent-text',
            html: tentLayer.tentData.group_name
        }),
        interactive: true
    }).addTo(map);

    newTent.textMarker = textMarker;

    makeTentDraggable(newTent);

    if (selectedTent === tentLayer) {
        selectedTent = newTent;
    }

    selectedTent = newTent;
    updateTentSelectionHighlight(newTent, true);
    return newTent;
}

function buildTentSidebar(searchTerm = "") {

    const sidebar = document.getElementById("tentSidebar");

    const groupedTents = {};

    tentDataFromDb.forEach(tent => {

    const searchText =
        `${tent.group_name} ${tent.object_id}`
            .toLowerCase();

    if (
        searchTerm &&
        !searchText.includes(searchTerm.toLowerCase())
    ) {
        return;
    }

    // If the sidebar filter is enabled, only include tents without coordinates
    if (showUnplacedOnly) {
        if (tent.latitude !== null && tent.longitude !== null) {
            return;
        }
    }

        const area = tent.nation || "Unassigned";

        if (!groupedTents[area]) {
            groupedTents[area] = [];
        }

        groupedTents[area].push(tent);
    });

    sidebar.innerHTML = "";

    Object.keys(groupedTents)
        .sort()
        .forEach(area => {

            const collapseId =
                `area-${area.replace(/\s+/g, "-")}`;

            let html = `
                <div class="mb-2">
                    <button
                        class="btn btn-toggle w-100 text-start"
                        data-bs-toggle="collapse"
                        data-bs-target="#${collapseId}">
                        ${area}
                    </button>

                    <div class="collapse" id="${collapseId}">
                        <div class="list-group">
            `;

            groupedTents[area].forEach(tent => {

                const onMap =
                    tent.latitude !== null &&
                    tent.longitude !== null;

                html += `
                    <div class="list-group-item">
                        <div>
                            <strong>${tent.group_name}</strong>
                            <br>
                            Tent ID: ${tent.object_id}
                        </div>

                        <button
                            class="btn btn-sm btn-primary mt-2"
                            onclick="${
                                onMap
                                    ? `findTentOnMap(${tent.object_id})`
                                    : `addExistingTentToMap(${tent.object_id})`
                            }">

                            ${
                                onMap
                                    ? "Find On Map"
                                    : "Add To Map"
                            }

                        </button>
                    </div>
                `;
            });

            html += `
                        </div>
                    </div>
                </div>
            `;

            sidebar.insertAdjacentHTML(
                "beforeend",
                html
            );
        });
}

function findTentOnMap(tentId) {

    const tentLayer = tentLayersById[tentId];

    if (!tentLayer) {
        return;
    }

    const center =
        tentLayer.centerPoint ||
        tentLayer.getBounds().getCenter();

    map.setView(center, 20);

    if (selectedTent) {
        updateTentSelectionHighlight(
            selectedTent,
            false
        );
    }

    selectedTent = tentLayer;

    updateTentSelectionHighlight(
        tentLayer,
        true
    );

    if (window.PUBLIC_VIEW === true) {
        // Public view: don't attempt to populate the edit form (it doesn't exist)
        if (tentLayer.tentData && tentLayer.tentData.group_name) {
            try { tentLayer.bindPopup(`<strong>${tentLayer.tentData.group_name}</strong>`).openPopup(); } catch (e) { /* ignore */ }
        }
        return;
    }

    populateTentForm(tentLayer.tentData);
}

let existingTentBeingPlaced = null;

function addExistingTentToMap(tentId) {

    const tent =
        tentDataFromDb.find(
            t => t.object_id === tentId
        );

    if (!tent) {
        return;
    }

    existingTentBeingPlaced = tent;

    tentData = {
        id: tent.object_id,
        group_name: tent.group_name,
        area: tent.nation,
        bell_size: tent.bell_size,
        length: tent.length,
        width: tent.width,
        rotation: tent.rotation || 0
    };

    placingTent = true;

    populateTentForm(tentData);
}

const tentSearchEl = document.getElementById("tentSearch");
const filterUnplacedEl = document.getElementById("filterUnplaced");

if (filterUnplacedEl) {
    filterUnplacedEl.addEventListener('change', function () {
        showUnplacedOnly = this.checked;
        buildTentSidebar(tentSearchEl?.value || "");
    });
}

if (tentSearchEl) {
    tentSearchEl.addEventListener("input", function () {
        buildTentSidebar(this.value);
    });
}

// Initial render
buildTentSidebar(
    tentSearchEl?.value || ""
);

// Live rotation / ghost helpers
function clearTentRotateGhost() {
    if (tentRotateGhost) {
        try { map.removeLayer(tentRotateGhost); } catch (e) { /* ignore */ }
        tentRotateGhost = null;
    }
}

const rotationEl = document.getElementById("Tent_Rotation");
if (rotationEl) {
    rotationEl.addEventListener('input', function (e) {
        const rot = parseFloat(this.value) || 0;
        // Update visible output next to slider
        const out = document.querySelector("#Tent_Rotation + output");
        if (out) out.value = rot;

        // If placing a tent, update the placing tent's rotation and refresh ghost at last mouse
        if (placingTent && tentData) {
            tentData.rotation = rot;
            if (ghostTent && lastMouseLatLng) {
                try { map.removeLayer(ghostTent); } catch (e) {}
                if (!isNaN(tentData.bell_size) && tentData.bell_size > 0) {
                    ghostTent = L.circle(lastMouseLatLng, {
                        radius: tentData.bell_size / 2,
                        color: '#3388ff',
                        weight: 2,
                        dashArray: '5,5',
                        fillOpacity: 0.2
                    });
                } else {
                    ghostTent = createTentPolygon(lastMouseLatLng, tentData.length, tentData.width, tentData.rotation, true);
                }
                ghostTent.addTo(map);
            }
            return;
        }

        // If a tent is selected (not being dragged), show a ghost overlay demonstrating rotation
        if (selectedTent) {
            clearTentRotateGhost();
            const center = selectedTent.centerPoint || selectedTent.getBounds().getCenter();
            const temp = Object.assign({}, selectedTent.tentData, { rotation: rot });
            tentRotateGhost = getTentLayerAtPosition(center, temp, true);
            tentRotateGhost.addTo(map);
        }
    });
}


// Make map read-only friendly: if PUBLIC_VIEW is true, avoid attaching any form population or placement logic
function makeTentDraggable(tentLayer) {
    if (window.PUBLIC_VIEW === true) {
        // In public view, clicking just zooms to tent and shows a simple popup
        tentLayer.on('click', function (e) {
            const center = tentLayer.centerPoint || tentLayer.getBounds().getCenter();
            map.setView(center, 20);
            if (tentLayer.tentData && tentLayer.tentData.group_name) {
                tentLayer.bindPopup(`<strong>${tentLayer.tentData.group_name}</strong>`).openPopup();
            }
        });

        if (tentLayer.textMarker) {
            tentLayer.textMarker.on('click', function (e) {
                const center = tentLayer.centerPoint || tentLayer.getBounds().getCenter();
                map.setView(center, 20);
                if (tentLayer.tentData && tentLayer.tentData.group_name) {
                    tentLayer.textMarker.bindPopup(`<strong>${tentLayer.tentData.group_name}</strong>`).openPopup();
                }
            });
        }

        return;
    }

    // Original interactive behavior
    tentLayer.on('click', function (e) {
        if (placingTent) {
            return;
        }

        if (L.Browser.touch) {
            selectTentForForm(tentLayer, e);
            return;
        }

        selectTentForForm(tentLayer, e);
    });

    tentLayer.on('touchend', function (e) {
        if (placingTent) {
            return;
        }

        selectTentForForm(tentLayer, e);
    });

    if (tentLayer.textMarker) {
        tentLayer.textMarker.on('click', function (e) {
            if (placingTent) {
                return;
            }

            selectTentForForm(tentLayer, e);
        });

        tentLayer.textMarker.on('touchend', function (e) {
            if (placingTent) {
                return;
            }

            selectTentForForm(tentLayer, e);
        });
    }
}

// Adjust buildTentSidebar for public mode to remove actions that add or edit tents
const _origBuildTentSidebar = buildTentSidebar;
buildTentSidebar = function(searchTerm = "") {
    const sidebar = document.getElementById("tentSidebar");

    const groupedTents = {};

    tentDataFromDb.forEach(tent => {
        const searchText = `${tent.group_name} ${tent.object_id}`.toLowerCase();
        if (searchTerm && !searchText.includes(searchTerm.toLowerCase())) {
            return;
        }

        // respect unplaced-only filter
        if (showUnplacedOnly) {
            if (tent.latitude !== null && tent.longitude !== null) {
                return;
            }
        }

        const area = tent.nation || "Unassigned";
        if (!groupedTents[area]) {
            groupedTents[area] = [];
        }
        groupedTents[area].push(tent);
    });

    sidebar.innerHTML = "";

    Object.keys(groupedTents).sort().forEach(area => {
        const collapseId = `area-${area.replace(/\s+/g, "-")}`;

        let html = `
            <div class="mb-2">
                <button
                    class="btn btn-toggle w-100 text-start"
                    data-bs-toggle="collapse"
                    data-bs-target="#${collapseId}">
                    ${area}
                </button>

                <div class="collapse" id="${collapseId}">
                    <div class="list-group">
        `;

        groupedTents[area].forEach(tent => {
            const onMap = tent.latitude !== null && tent.longitude !== null;

            html += `
                <div class="list-group-item">
                    <div>
                        <strong>${tent.group_name}</strong>
                        <br>
                        Tent ID: ${tent.object_id}
                    </div>
            `;

            if (window.PUBLIC_VIEW === true) {
                if (onMap) {
                    html += `
                        <button class="btn btn-sm btn-primary mt-2" onclick="findTentOnMap(${tent.object_id})">Find On Map</button>
                    `;
                }
            } else {
                html += `
                    <button class="btn btn-sm btn-primary mt-2" onclick="${onMap ? `findTentOnMap(${tent.object_id})` : `addExistingTentToMap(${tent.object_id})`} ">${onMap ? "Find On Map" : "Add To Map"}</button>
                `;
            }

            html += `</div>`;
        });

        html += `
                    </div>
                </div>
            </div>
        `;

        sidebar.insertAdjacentHTML("beforeend", html);
    });
};

}

