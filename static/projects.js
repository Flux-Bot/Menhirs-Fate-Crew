function New_Project() {
    const projectDiv = document.querySelector(".New_Project");

    projectDiv.classList.toggle("hidden");

    if (!projectDiv.classList.contains("hidden")) {
        setTimeout(() => {
            map.invalidateSize();
        }, 100);
    }
}


function updateLinkButtonState(card) {
    const publicFormToggle = card.querySelector('[data-field="public_form_visible"]');
    const publicFormLink = card.querySelector('.copy-form-link');
    const publicFormDisabled = card.querySelector('.copy-form-link-disabled');

    if (publicFormToggle && publicFormLink && publicFormDisabled) {
        const enabled = publicFormToggle.checked;
        publicFormLink.classList.toggle('d-none', !enabled);
        publicFormDisabled.classList.toggle('d-none', enabled);
    }

    const publicViewToggle = card.querySelector('[data-field="public_view_visible"]');
    const publicViewLink = card.querySelector('.copy-public-link');
    const publicViewDisabled = card.querySelector('.public-view-disabled');

    if (publicViewToggle && publicViewLink && publicViewDisabled) {
        const enabled = publicViewToggle.checked;
        publicViewLink.classList.toggle('d-none', !enabled);
        publicViewDisabled.classList.toggle('d-none', enabled);
    }
}

document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.card').forEach(card => updateLinkButtonState(card));

    document.querySelectorAll('.project-toggle').forEach(toggle => {
        toggle.addEventListener('change', async function () {
            updateLinkButtonState(this.closest('.card'));

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
