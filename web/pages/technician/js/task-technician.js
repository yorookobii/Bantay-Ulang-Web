(function() {
    function updateFilterCounts() {
        var taskCards = document.querySelectorAll('.task-card');
        var counts = { all: taskCards.length, pending: 0, 'in-progress': 0, completed: 0 };
        taskCards.forEach(function(card) {
            var status = card.getAttribute('data-status');
            if (status && counts[status] !== undefined) counts[status]++;
        });
        document.querySelectorAll('.task-filter-count').forEach(function(el) {
            var key = el.getAttribute('data-for');
            if (key && counts[key] !== undefined) el.textContent = '(' + counts[key] + ')';
        });
    }

    function init() {
        var filterBtns = document.querySelectorAll('.task-filter-btn');
        var taskCards = document.querySelectorAll('.task-card');

        updateFilterCounts();

        if (filterBtns.length && taskCards.length) {
            filterBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var filter = btn.getAttribute('data-filter');
                    filterBtns.forEach(function(b) {
                        b.classList.remove('active');
                        b.setAttribute('aria-pressed', 'false');
                    });
                    btn.classList.add('active');
                    btn.setAttribute('aria-pressed', 'true');

                    taskCards.forEach(function(card) {
                        var status = card.getAttribute('data-status');
                        var show =
                            filter === 'all' ||
                            (filter === 'pending' && status === 'pending') ||
                            (filter === 'in-progress' && status === 'in-progress') ||
                            (filter === 'completed' && status === 'completed');
                        card.style.display = show ? '' : 'none';
                    });
                });
            });
        }

        document.querySelectorAll('.btn-start-working').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (btn.disabled) return;
                var card = btn.closest('.task-card');
                if (card) {
                    card.setAttribute('data-status', 'in-progress');
                    var statusDot = card.querySelector('.task-status-dot');
                    var statusLabel = card.querySelector('.task-status-label');
                    if (statusDot) {
                        statusDot.classList.remove('pending');
                        statusDot.classList.add('in-progress');
                    }
                    if (statusLabel) statusLabel.textContent = 'IN PROGRESS';
                    updateFilterCounts();
                }
            });
        });

        document.querySelectorAll('.btn-mark-complete').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var card = btn.closest('.task-card');
                if (card) {
                    card.setAttribute('data-status', 'completed');
                    var statusDot = card.querySelector('.task-status-dot');
                    var statusLabel = card.querySelector('.task-status-label');
                    if (statusDot) {
                        statusDot.classList.remove('pending', 'in-progress');
                        statusDot.classList.add('completed');
                    }
                    if (statusLabel) statusLabel.textContent = 'COMPLETED';
                    updateFilterCounts();
                }
            });
        });

        document.querySelectorAll('.btn-show-details').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var card = btn.closest('.task-card');
                if (!card) return;
                var details = card.querySelector('.task-card-details');
                if (!details) return;
                var isOpen = details.classList.toggle('show');
                var icon = btn.querySelector('i');
                if (icon) {
                    icon.className = isOpen ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
                }
                var textNode = Array.prototype.find.call(btn.childNodes, function(n) { return n.nodeType === 3; });
                if (textNode) {
                    textNode.textContent = isOpen ? 'Hide Details' : 'Show Details';
                } else {
                    btn.appendChild(document.createTextNode(isOpen ? 'Hide Details' : 'Show Details'));
                }
                btn.setAttribute('aria-label', isOpen ? 'Hide details' : 'Show details');
            });
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
