/**
 * Sidebar UI Controller
 * Handles sidebar interactions and section toggling
 */

class SidebarController {
    constructor() {
        this.initializeSidebar();
        this.bindEvents();
    }

    initializeSidebar() {
        // Initialize all sections as collapsed except the first one
        const sections = document.querySelectorAll('.section-content');
        sections.forEach((section, index) => {
            if (index === 0) {
                section.classList.add('expanded');
                const header = section.previousElementSibling;
                if (header) {
                    header.classList.add('expanded');
                }
            }
        });
    }

    bindEvents() {
        // Add event listeners for section headers
        document.addEventListener('click', (event) => {
            if (event.target.classList.contains('section-header') || 
                event.target.closest('.section-header')) {
                
                const header = event.target.classList.contains('section-header') 
                    ? event.target 
                    : event.target.closest('.section-header');
                
                this.toggleSection(header);
            }
        });
    }

    toggleSection(header) {
        const content = header.nextElementSibling;
        const icon = header.querySelector('.expand-icon');
        
        if (content && content.classList.contains('section-content')) {
            const isExpanded = content.classList.contains('expanded');
            
            if (isExpanded) {
                content.classList.remove('expanded');
                header.classList.remove('expanded');
                if (icon) icon.textContent = '▶';
            } else {
                content.classList.add('expanded');
                header.classList.add('expanded');
                if (icon) icon.textContent = '▼';
            }
        }
    }

    expandSection(sectionId) {
        const content = document.getElementById(sectionId);
        const header = content ? content.previousElementSibling : null;
        
        if (content && header) {
            content.classList.add('expanded');
            header.classList.add('expanded');
            const icon = header.querySelector('.expand-icon');
            if (icon) icon.textContent = '▼';
        }
    }

    collapseSection(sectionId) {
        const content = document.getElementById(sectionId);
        const header = content ? content.previousElementSibling : null;
        
        if (content && header) {
            content.classList.remove('expanded');
            header.classList.remove('expanded');
            const icon = header.querySelector('.expand-icon');
            if (icon) icon.textContent = '▶';
        }
    }

    collapseAll() {
        const sections = document.querySelectorAll('.section-content');
        sections.forEach(section => {
            section.classList.remove('expanded');
            const header = section.previousElementSibling;
            if (header) {
                header.classList.remove('expanded');
                const icon = header.querySelector('.expand-icon');
                if (icon) icon.textContent = '▶';
            }
        });
    }

    expandAll() {
        const sections = document.querySelectorAll('.section-content');
        sections.forEach(section => {
            section.classList.add('expanded');
            const header = section.previousElementSibling;
            if (header) {
                header.classList.add('expanded');
                const icon = header.querySelector('.expand-icon');
                if (icon) icon.textContent = '▼';
            }
        });
    }
}

// Global function for backward compatibility
function toggleSection(sectionId) {
    const content = document.getElementById(sectionId);
    const header = content ? content.previousElementSibling : null;
    
    if (window.sidebarController) {
        window.sidebarController.toggleSection(header);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.sidebarController = new SidebarController();
});

// Export for module use
window.SidebarController = SidebarController;