const map = L.map('map').setView([52.05299, -1.04628], 17);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

//Project Form
document.getElementById('projectForm').addEventListener('submit', function () {

    const center = map.getCenter();

    document.getElementById('latitude').value = center.lat;
    document.getElementById('longitude').value = center.lng;
    document.getElementById('zoom').value = map.getZoom();

});
