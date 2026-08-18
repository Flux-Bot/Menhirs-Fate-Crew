function New_Project() {
    const projectDiv = document.querySelector(".New_Project");

    projectDiv.classList.toggle("hidden");

    if (!projectDiv.classList.contains("hidden")) {
        setTimeout(() => {
            map.invalidateSize();
        }, 100);
    }
}


document.addEventListener('DOMContentLoaded', function () {

    document.querySelectorAll('.project-toggle').forEach(toggle => {

        toggle.addEventListener('change', async function () {

            try {
                const response = await fetch('/update-project-toggle', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        project_id: this.dataset.projectId,
                        field: this.dataset.field,
                        value: this.checked
                    })
                });

                const result = await response.json();

                if (!result.success) {
                    alert('Failed to save change');
                }

            } catch (err) {
                console.error(err);
                alert('Error updating setting');
            }

        });

    });
});
