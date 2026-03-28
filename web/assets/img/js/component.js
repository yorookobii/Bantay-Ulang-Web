function loadComponent(id, file) {
    fetch(file)
        .then(res => res.text())
        .then(data => {
            document.getElementById(id).innerHTML = data;
        });
}

// Adjust path depending on folder depth
loadComponent("sidebar-container", "../components/sidebar.html");
loadComponent("topbar-container", "../components/topbar.html");
