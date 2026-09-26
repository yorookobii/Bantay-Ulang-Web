// Topbar profile menu: accessible menu button bound to the .pm-trigger chip.

const MENU_ID = 'pmMenu';

function buildMenu(profileUrl, settingsUrl) {
    const menu = document.createElement('div');
    menu.className = 'pm-menu';
    menu.id = MENU_ID;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Account');
    menu.innerHTML = `
        <a class="pm-item" role="menuitem" tabindex="-1" href="${profileUrl}">
            <i class="fa-solid fa-user" aria-hidden="true"></i><span>My Profile</span>
            <span class="pm-badge pm-role"></span>
        </a>
        <a class="pm-item" role="menuitem" tabindex="-1" href="${settingsUrl}">
            <i class="fa-solid fa-gear" aria-hidden="true"></i><span>Settings</span>
        </a>
        <button type="button" class="pm-item" role="menuitem" tabindex="-1" data-pm="password">
            <i class="fa-solid fa-lock" aria-hidden="true"></i><span>Change Password</span>
        </button>
        <div class="pm-sep" role="separator"></div>
        <button type="button" class="pm-item pm-logout" role="menuitem" tabindex="-1" data-pm="logout">
            <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i><span>Log Out</span>
        </button>`;
    return menu;
}

/**
 * initProfileMenu({ profileUrl, settingsUrl, onChangePassword, onLogout })
 * No-op on pages without a .pm-trigger chip.
 */
export function initProfileMenu({ profileUrl, settingsUrl, onChangePassword, onLogout }) {
    const trigger = document.querySelector('.pm-trigger');
    if (!trigger || document.getElementById(MENU_ID)) return;

    const menu = buildMenu(profileUrl, settingsUrl);
    trigger.insertAdjacentElement('afterend', menu);
    trigger.setAttribute('aria-controls', MENU_ID);

    // Badge copies the chip's role now; userProfile.js repaints every .pm-role later.
    const chipRole = trigger.querySelector('.pm-role');
    menu.querySelector('.pm-badge').textContent = chipRole ? chipRole.textContent : '';

    const items = () => [...menu.querySelectorAll('.pm-item')];
    const isOpen = () => trigger.getAttribute('aria-expanded') === 'true';

    function open(focusIndex = 0) {
        document.getElementById('notificationDropdown')?.classList.remove('show');
        document.querySelector('.notification-icon[aria-expanded]')?.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-expanded', 'true');
        menu.dataset.open = '';
        const list = items();
        list[(focusIndex + list.length) % list.length]?.focus();
    }

    function close(returnFocus) {
        if (!isOpen()) return;
        trigger.setAttribute('aria-expanded', 'false');
        delete menu.dataset.open;
        if (returnFocus) trigger.focus();
    }

    trigger.addEventListener('click', () => (isOpen() ? close(true) : open()));
    trigger.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); open(0); }
        if (e.key === 'ArrowUp') { e.preventDefault(); open(-1); }
    });

    menu.addEventListener('keydown', (e) => {
        const list = items();
        const i = list.indexOf(document.activeElement);
        const moves = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 };
        if (e.key in moves) {
            e.preventDefault();
            list[(moves[e.key] + list.length) % list.length].focus();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close(true);
        } else if (e.key === 'Tab') {
            close(false);
        }
    });

    menu.addEventListener('click', (e) => {
        const action = e.target.closest('[data-pm]')?.dataset.pm;
        if (action === 'password') { close(false); onChangePassword?.(); }
        if (action === 'logout') onLogout?.();
    });

    // Capture phase so page handlers that stopPropagation (e.g. the bell) still close the menu.
    document.addEventListener('click', (e) => {
        if (!isOpen() || trigger.contains(e.target) || menu.contains(e.target)) return;
        const focusable = e.target.closest('a, button, input, select, textarea, [tabindex]');
        close(!focusable);
    }, true);
}
