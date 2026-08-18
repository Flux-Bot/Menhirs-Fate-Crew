document.getElementById("Bell_Size").addEventListener("input", function () {
if (this.value !== "") {
    document.getElementById("Tent_Length").value = "";
    document.getElementById("Tent_Width").value = "";
    }
});

document.getElementById("Tent_Length").addEventListener("input", function () {
if (this.value !== "") {
    document.getElementById("Bell_Size").value = "";
    }
});

document.getElementById("Tent_Width").addEventListener("input", function () {
if (this.value !== "") {
    document.getElementById("Bell_Size").value = "";
    }
});

