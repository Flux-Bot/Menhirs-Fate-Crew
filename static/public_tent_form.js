function updateSubmitButton() {
    const tentCount = document.querySelectorAll(".tent").length;
    document.getElementById("submitBtn").disabled = tentCount === 0;
}

function removeTent(button) {
    button.parentElement.remove();
    updateSubmitButton();
}

function add_bell_tent() {
    const tentsDiv = document.getElementById("tents");

    const newTent = document.createElement("div");
    newTent.className = "tent tent-card";
    newTent.dataset.type = "bell";

    newTent.innerHTML = `
        <h5 class="mb-3">Bell Tent</h5>

        <div class="mb-3">
            <label class="form-label">Size (Meters)</label>
            <input
                type="number"
                class="form-control bell-size"
                min="1"
                required>
        </div>

        <button
            type="button"
            class="btn btn-outline-danger"
            onclick="removeTent(this)">
            Delete Tent
        </button>
    `;

    tentsDiv.appendChild(newTent);
    updateSubmitButton();
}

function add_rectangle_tent() {
    const tentsDiv = document.getElementById("tents");

    const newTent = document.createElement("div");
    newTent.className = "tent tent-card";
    newTent.dataset.type = "rectangle";

    newTent.innerHTML = `
        <h5 class="mb-3">Rectangle Tent / Awning</h5>

        <div class="row">
            <div class="col-12 col-md-6 mb-3">
                <label class="form-label">Length (Meters)</label>
                <input
                    type="number"
                    class="form-control length"
                    min="1"
                    required>
            </div>

            <div class="col-12 col-md-6 mb-3">
                <label class="form-label">Width (Meters)</label>
                <input
                    type="number"
                    class="form-control width"
                    min="1"
                    required>
            </div>
        </div>

        <button
            type="button"
            class="btn btn-outline-danger"
            onclick="removeTent(this)">
            Delete Tent
        </button>
    `;

    tentsDiv.appendChild(newTent);
    updateSubmitButton();
}

document.getElementById("Public_Tent_Form").addEventListener("submit", async function(event) {
    event.preventDefault();

    const tents = [];

    document.querySelectorAll(".tent").forEach(tent => {
        if (tent.dataset.type === "bell") {
            tents.push({
                type: "bell",
                bell_size: tent.querySelector(".bell-size").value
            });
        }

        if (tent.dataset.type === "rectangle") {
            tents.push({
                type: "rectangle",
                length: tent.querySelector(".length").value,
                width: tent.querySelector(".width").value
            });
        }
    });

    const data = {
        project_id: document.getElementById("project_id").value,
        group_name: document.getElementById("Group_Name").value,
        nation: document.getElementById("nation").value,
        tents: tents
    };

    try {
        const response = await fetch("/submit_camp_form", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (response.ok) {
            // Hide the form
            document.getElementById("Public_Tent_Form").style.display = "none";

            // Show success message
            const successMessage = document.getElementById("successMessage");
            successMessage.classList.remove("d-none");
        } else {
            alert(result.error || "There was a problem submitting your request.");
        }

    } catch (error) {
        console.error(error);
        alert("Unable to submit the form. Please try again.");
    }
});