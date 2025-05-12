class TabWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
  
      // Setup the internal structure
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            width: 100%;
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          .tab-container {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: calc(100% - 5px);
          }
          
          .tab-buttons {
            display: flex;
            border-bottom: 1px solid #ddd;
            background-color: #f8f9fa;
          }
          
          .tab-button {
            padding: 5px 8px;
            cursor: pointer;
            background: #f0f0f0;
            border: 1px solid #ddd;
            border-bottom: none;
            border-radius: 5px 5px 0 0;
            margin-right: 5px;
            outline: none;
            transition: background-color 0.3s;
          }
          
          .tab-button.active {
            background: white;
            border-bottom-color: white;
            position: relative;
          }
          
          .tab-button:hover:not(.active) {
            background-color: #e9ecef;
          }

          ::slotted([tab-content]) {
            display: none;
            height: calc(100% - 40px);
            padding: 15px;
            border: 1px solid #ddd;
            border-top: none;
            overflow: auto;
          }

          ::slotted([tab-content].active) {
            display: block;
            animation: fadeIn 0.3s ease;
          }

          .tab-content-container {
            height: calc(100% - 5px); /* Adjust based on tab button height */
            overflow: auto;
          }

          .tab-content {
            display: none;
            padding: 15px;
            border: 1px solid #ddd;
            border-top: none;
          }

          .tab-content.active {
            display: block;
            animation: fadeIn 0.3s ease;
          }

          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        </style>
        <div class="tab-container">
          <div class="tab-buttons"></div>
          <div class="tab-content-container">
            <slot name="tab-content"></slot>
          </div>
        </div>
      `;
      
      this._tabButtons = this.shadowRoot.querySelector('.tab-buttons');
      this._initialized = false;
    }
  
    connectedCallback() {
      if (this._initialized) return;
      this._initialized = true;
      
      // Set up tabs based on children with tab-content attribute
      this._setupTabs();
      
      // Select the default tab
      const defaultTab = this.getAttribute('default-tab') || 0;
      this.selectTab(defaultTab);
      
      // Add event listener for attribute changes
      this.addEventListener('tabselected', (e) => {
        this.selectTab(e.detail.tabId);
      });
    }
    
    disconnectedCallback() {
      // Clean up any event listeners
      this._tabButtons.querySelectorAll('.tab-button').forEach(button => {
        button.removeEventListener('click', this._handleTabClick);
      });
    }
    
    static get observedAttributes() {
      return ['default-tab', 'current-tab'];
    }
    
    attributeChangedCallback(name, oldValue, newValue) {
      if (name === 'default-tab' && this._initialized && oldValue !== newValue) {
        this.selectTab(newValue);
      }
      if (name === 'current-tab' && this._initialized) {
        this.selectTab(newValue);
      }
    }
    
    _setupTabs() {
      // Clear existing buttons
      this._tabButtons.innerHTML = '';
      
      // Get all tab content elements
      const tabContents = Array.from(this.querySelectorAll('[tab-content]'));
      
      // Create buttons for each tab
      tabContents.forEach((content, index) => {
        // Get the tab id and label
        const tabId = content.getAttribute('tab-content');
        const tabLabel = content.getAttribute('tab-label') || `Tab ${index + 1}`;
        
        // Create the button
        const button = document.createElement('button');
        button.className = 'tab-button';
        button.textContent = tabLabel;
        button.dataset.tabId = tabId;
        
        // Add click handler
        button.addEventListener('click', this._handleTabClick.bind(this));
        
        // Add to tab buttons
        this._tabButtons.appendChild(button);
      });
    }
    
    _handleTabClick(event) {
      const tabId = event.currentTarget.dataset.tabId;
      this.selectTab(tabId);
      
      // Dispatch custom event
      this.dispatchEvent(new CustomEvent('tab-changed', {
        bubbles: true,
        composed: true,
        detail: { tabId }
      }));
    }
    
    selectTab(tabId) {
      // If tabId is a number, treat it as an index
      if (!isNaN(tabId)) {
        const index = parseInt(tabId, 10);
        const buttons = this._tabButtons.querySelectorAll('.tab-button');
        if (index >= 0 && index < buttons.length) {
          tabId = buttons[index].dataset.tabId;
        }
      }
      
      // Remove active class from all tabs
      this._tabButtons.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
      });
      
      // Remove active class from all content
      this.querySelectorAll('[tab-content]').forEach(content => {
        content.classList.remove('active');
      });
      
      // Add active class to selected tab and content
      const selectedButton = this._tabButtons.querySelector(`[data-tab-id="${tabId}"]`);
      const selectedContent = this.querySelector(`[tab-content="${tabId}"]`);
      
      if (selectedButton && selectedContent) {
        selectedButton.classList.add('active');
        selectedContent.classList.add('active');
      }
    }
    
    // Public methods
    getActiveTab() {
      const activeButton = this._tabButtons.querySelector('.tab-button.active');
      return activeButton ? activeButton.dataset.tabId : null;
    }
    
    refreshTabs() {
      this._setupTabs();
    }
  }
  
  // Register the custom element
  customElements.define('tab-widget', TabWidget);