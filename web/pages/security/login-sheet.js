// Scroll-driven sheet-rise animation for the login page.
// Moved out of an inline <script> so the login page can run a strict
// Content-Security-Policy without 'unsafe-inline' (security hardening stage 2).
// Loaded as a classic (non-module) script so it still runs synchronously
// before first paint, exactly like the former inline block.
(function () {
    var sheet = document.getElementById('login-sheet');
    var hero  = document.getElementById('welcome-hero');
    var cue   = document.getElementById('scroll-cue');
    var veil  = document.getElementById('photo-veil');

    var PEEK          = 116; // px of card initially visible above the viewport bottom
    var BOTTOM_OFFSET = 24;  // must match CSS bottom: 24px on .login-sheet

    function easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function render(rawProgress) {
        // Full card-rise effect happens over the first 50% of page scroll
        var p = Math.min(rawProgress * 2, 1);
        var e = easeInOutQuad(p);

        /*
           Card is centered via translateX(-50%) (left: 50% in CSS).
           The Y offset accounts for the CSS bottom: 24px so that only
           PEEK px of the card top are visible at scroll position 0.
        */
        var hidden = Math.max(sheet.offsetHeight - PEEK + BOTTOM_OFFSET, 0);
        sheet.style.transform =
            'translateX(-50%) translateY(' + Math.round(hidden * (1 - e)) + 'px)';

        // Hero fades out and drifts upward
        hero.style.opacity   = Math.max(1 - e * 1.8, 0);
        hero.style.transform = 'translateY(' + Math.round(e * -44) + 'px)';

        // Scroll cue fades out quickly in the first quarter of card travel
        cue.style.opacity = Math.max(1 - e * 4, 0);

        // Veil deepens subtly as form comes into focus
        veil.style.background =
            'rgba(5,18,20,' + (0.40 + e * 0.18).toFixed(3) + ')';
    }

    var motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!motionOK) {
        // Skip scroll theatre — surface the form immediately
        sheet.style.transform   = 'translateX(-50%) translateY(0)';
        hero.style.opacity      = '0';
        cue.style.opacity       = '0';
        veil.style.background   = 'rgba(5,18,20,0.58)';
        return;
    }

    function onScroll() {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        render(max > 0 ? window.scrollY / max : 1);
    }

    // Set initial positions before the first paint
    render(0);

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    // Handle reload with pre-existing scroll position
    requestAnimationFrame(onScroll);
})();
