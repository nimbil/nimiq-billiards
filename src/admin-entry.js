/**
 * Admin Dashboard Entry Point
 * 
 * Initializes admin UI and exposes show/hide functions.
 */

import { initAdmin, showAdmin, hideAdmin } from './ui/admin.js';

// Initialize admin dashboard
document.addEventListener('DOMContentLoaded', () => {
  initAdmin();
});

// Expose functions globally for game UI integration
window._showAdmin = showAdmin;
window._hideAdmin = hideAdmin;

// Auto-show admin if URL has ?admin=true
if (window.location.search.includes('admin=true')) {
  setTimeout(() => showAdmin(), 100);
}
