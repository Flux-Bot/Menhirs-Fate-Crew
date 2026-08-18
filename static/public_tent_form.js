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

    newTent.innerHTML = `
        <div class="tent" data-type="bell">
            <label>Bell Tent Size (Meters):</label>
            <input type="number" class="bell-size" required>
            <button type="button" onclick="removeTent(this)">Delete</button>
        </div>
    `;

    tentsDiv.appendChild(newTent);
    updateSubmitButton();
}

function add_rectangle_tent() {
    const tentsDiv = document.getElementById("tents");
    const newTent = document.createElement("div");

    newTent.innerHTML = `
        <div class="tent" data-type="rectangle">
            <p>Rectangle Tent/Awning</p>
            <label>Length (Meters):</label>
            <input type="number" class="length" required><br>
            <label>Width (Meters):</label>
            <input type="number" class="width" required>
            <button type="button" onclick="removeTent(this)">Delete</button>
        </div>
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