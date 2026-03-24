// App State
let currentLevel = 'states'; // states, counties
let currentPath = { state: null };
let activeColor = '#6366f1';
const filledColors = new Map(); // Key: geo id, Value: color

const breadcrumbs = document.getElementById('breadcrumbs');
const bcCounty = document.getElementById('bc-county');
const viewLabel = document.getElementById('current-view-label');
const itemCount = document.getElementById('item-count');
const colorPalette = document.getElementById('color-palette');
const tooltip = document.getElementById('tooltip');
const mapContainer = document.getElementById('map-container');
const resultsOverlay = document.getElementById('results-overlay');
const resultsList = document.getElementById('results-list');
const calculateBtn = document.getElementById('calculate-btn');
const resetBtn = document.getElementById('reset-btn');
const closeResultsBtn = document.getElementById('close-results');
const demCountEl = document.getElementById('dem-count');
const repCountEl = document.getElementById('rep-count');
const svg = d3.select("#magic-wall-svg");

let width = mapContainer.clientWidth;
let height = mapContainer.clientHeight;
const g = svg.append("g");

// Zoom behavior
const zoom = d3.zoom()
    .scaleExtent([1, 12])
    .on("zoom", (event) => {
        g.attr("transform", event.transform);
    });

svg.call(zoom);

svg.on("dblclick.zoom", null);

const showTooltip = (event, text, additionalInfo = '') => {
    tooltip.innerHTML = `<strong>${text}</strong>${additionalInfo ? `<br><span style="color: var(--accent)">${additionalInfo}</span>` : ''}`;
    tooltip.classList.remove('hidden');
    tooltip.style.left = (event.pageX + 10) + 'px';
    tooltip.style.top = (event.pageY - 30) + 'px';
};
const hideTooltip = () => tooltip.classList.add('hidden');

let usData = null;

// Initialize
async function init() {
    try {
        // Load US Atlas data (States and Counties)
        usData = await d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json");
        
        // Handle preloaded state vs localStorage
        let hasData = false;
        if (typeof preloadData !== 'undefined' && preloadData.length > 0) {
            // First time load or explicit data drop
            localStorage.setItem('magicWallColors', JSON.stringify(preloadData));
            hasData = true;
        }
        
        loadState();
        renderStates();
        setupEventListeners();
        window.addEventListener('resize', handleResize);
        
        // Automatically load Minnesota Data to visually see if we loaded it, but stay on US Map view
        if (hasData) {
            calculateResults();
        }
        
    } catch (error) {
        console.error("Error loading map data:", error);
        viewLabel.innerText = "Error loading map data. Please check connection.";
    }
}

function handleResize() {
    width = mapContainer.clientWidth;
    height = mapContainer.clientHeight;
    renderStates();
}

function setupEventListeners() {
    colorPalette.addEventListener('click', (e) => {
        if (e.target.classList.contains('color-btn')) {
            document.querySelectorAll('.color-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            activeColor = e.target.dataset.color;
        }
    });

    breadcrumbs.addEventListener('click', (e) => {
        const item = e.target.closest('.breadcrumb-item');
        if (!item) return;
        if (item.dataset.level === 'states') navigateToStates();
    });

    calculateBtn.addEventListener('click', calculateResults);
    resetBtn.addEventListener('click', resetMap);
    closeResultsBtn.addEventListener('click', () => resultsOverlay.classList.add('hidden'));
}

function renderStates() {
    currentLevel = 'states';
    currentPath.state = null;
    g.selectAll("*").remove();

    const states = topojson.feature(usData, usData.objects.states).features;
    const allCountiesCount = topojson.feature(usData, usData.objects.counties).features;

    // Fit projection to container
    const projection = d3.geoAlbersUsa().scale(width * 1.1).translate([width / 2, height / 2]);
    const path = d3.geoPath().projection(projection);

    viewLabel.innerText = "Click on a state to color counties • State color shows county majority";
    itemCount.innerText = "50 States";

    const stateGroups = g.selectAll(".state-group")
        .data(states)
        .enter()
        .append("g")
        .attr("class", "state-group");

    stateGroups.append("path")
        .attr("class", "state-path fade-in")
        .attr("d", path)
        .style("fill", d => {
            const stats = getStateStats(d.id, allCountiesCount);
            if (stats.totalColored === 0) return 'rgba(75, 85, 99, 0.4)';
            return stats.majorityColor;
        })
        .style("fill-opacity", d => {
            const stats = getStateStats(d.id, allCountiesCount);
            return stats.totalColored === 0 ? 0.4 : 0.8;
        })
        .on("mouseover", (event, d) => {
            const stats = getStateStats(d.id, allCountiesCount);
            const info = stats.totalColored > 0 ? `Lead: ${Math.round(stats.percentage)}%` : '';
            showTooltip(event, d.properties.name, info);
        })
        .on("mouseout", hideTooltip)
        .on("click", (event, d) => {
            if (event.defaultPrevented) return;
            navigateToCounties(d);
        });

    // Add labels for percentage
    stateGroups.each(function (d) {
        const stats = getStateStats(d.id, allCountiesCount);
        if (stats.totalColored > 0) {
            const centroid = path.centroid(d);
            if (!isNaN(centroid[0])) {
                const group = d3.select(this);

                group.append("text")
                    .attr("class", "state-label state-percent")
                    .attr("x", centroid[0])
                    .attr("y", centroid[1] + 5)
                    .text(`${Math.round(stats.percentage)}%`);

                group.append("text")
                    .attr("class", "state-label state-name")
                    .attr("x", centroid[0])
                    .attr("y", centroid[1] - 12)
                    .text(d.properties.name);
            }
        }
    });

    bcCounty.classList.add('hidden');
    document.querySelector('[data-level="states"]').classList.add('active');

    // Reset zoom state to identity
    svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
}

function getStateStats(stateId, allCounties) {
    const stateCounties = allCounties.filter(c => c.id.slice(0, 2) === stateId);
    let red = 0;
    let blue = 0;

    stateCounties.forEach(c => {
        const data = filledColors.get(`county-${c.id}`);
        const color = typeof data === 'object' ? data.color : data;
        if (color === '#ef4444') red++;
        if (color === '#3b82f6') blue++;
    });

    const totalColored = red + blue;
    if (totalColored === 0) return { totalColored: 0 };

    const majorityColor = red >= blue ? '#ef4444' : '#3b82f6';
    const majorityCount = Math.max(red, blue);
    const percentage = (majorityCount / stateCounties.length) * 100;

    return {
        totalColored,
        majorityColor,
        percentage,
        isTie: red === blue
    };
}

function renderCounties(stateFeature) {
    currentLevel = 'counties';
    currentPath.state = stateFeature;
    g.selectAll("*").remove();

    const stateId = stateFeature.id;
    const allCounties = topojson.feature(usData, usData.objects.counties).features;
    const stateCounties = allCounties.filter(d => d.id.slice(0, 2) === stateId);

    // Use the same projection as states for consistency during zoom
    const projection = d3.geoAlbersUsa().scale(width * 1.1).translate([width / 2, height / 2]);
    const path = d3.geoPath().projection(projection);

    viewLabel.innerText = `${stateFeature.properties.name} • Click to fill • Drag to pan • Scroll to zoom`;
    itemCount.innerText = `${stateCounties.length} Counties`;

    g.selectAll(".county-path")
        .data(stateCounties)
        .enter()
        .append("path")
        .attr("class", "county-path fade-in")
        .attr("d", path)
        .style("fill", d => {
            const data = filledColors.get(`county-${d.id}`);
            return (typeof data === 'object' ? data.color : data) || null;
        })
        .on("mouseover", (event, d) => {
            const data = filledColors.get(`county-${d.id}`);
            const info = (data && data.percentage) ? `${data.percentage}%` : '';
            showTooltip(event, d.properties.name, info);
        })
        .on("mouseout", hideTooltip)
        .on("click", (event, d) => {
            if (event.defaultPrevented) return;
            fillShape(d3.select(event.target), `county-${d.id}`);
        });

    zoomToFeature(stateFeature);
}

function fillShape(selection, id) {
    if (activeColor === 'none') {
        selection.style("fill", null);
        filledColors.delete(id);
    } else {
        const percentage = prompt("Enter percentage for this county (0-100):", "");
        const pctValue = percentage !== null && percentage !== "" ? parseFloat(percentage) : null;

        selection.style("fill", activeColor);
        filledColors.set(id, { color: activeColor, percentage: pctValue });

        // Show immediate feedback in tooltip
        const name = selection.datum().properties.name;
        showTooltip(d3.event || { pageX: 0, pageY: 0 }, name, pctValue ? `${pctValue}%` : '');
    }
    saveState();
}

function saveState() {
    const data = JSON.stringify(Array.from(filledColors.entries()));
    localStorage.setItem('magicWallColors', data);
    updateLiveCounter();
}

function loadState() {
    const data = localStorage.getItem('magicWallColors');
    if (data) {
        const entries = JSON.parse(data);
        entries.forEach(([id, value]) => filledColors.set(id, value));
    }
    updateLiveCounter();
}

function updateLiveCounter() {
    let repCount = 0;
    let demCount = 0;
    
    filledColors.forEach((data, id) => {
        if (!id.startsWith('county-')) return;
        const color = typeof data === 'object' ? data.color : data;
        if (color === '#ef4444') repCount++;
        if (color === '#3b82f6') demCount++;
    });

    if (demCountEl) demCountEl.innerText = demCount;
    if (repCountEl) repCountEl.innerText = repCount;
    
    // Update progress bar
    const total = demCount + repCount;
    const demProgress = document.getElementById('dem-progress');
    const repProgress = document.getElementById('rep-progress');
    
    if (total === 0) {
        if (demProgress) demProgress.style.width = '50%';
        if (repProgress) repProgress.style.width = '50%';
    } else {
        const demPct = (demCount / total) * 100;
        const repPct = (repCount / total) * 100;
        if (demProgress) demProgress.style.width = `${demPct}%`;
        if (repProgress) repProgress.style.width = `${repPct}%`;
    }
}

function resetMap() {
    if (confirm("Are you sure you want to clear all colors?")) {
        filledColors.clear();
        localStorage.removeItem('magicWallColors');
        if (currentLevel === 'states') renderStates();
        else renderCounties(currentPath.state);
    }
}

function calculateResults() {
    const counts = {
        '#ef4444': 0, // Red
        '#3b82f6': 0  // Blue
    };

    // Count counties
    filledColors.forEach((data, id) => {
        const color = typeof data === 'object' ? data.color : data;
        if (id.startsWith('county-') && (color === '#ef4444' || color === '#3b82f6')) {
            counts[color]++;
        }
    });

    resultsList.innerHTML = '';

    // Republican Row
    const repRow = document.createElement('div');
    repRow.className = 'result-row';
    repRow.innerHTML = `
        <div style="display: flex; align-items: center; gap: 1rem;">
            <div class="result-color" style="background-color: #ef4444"></div>
            <span>Republican</span>
        </div>
        <span class="result-count" style="color: #ef4444">${counts['#ef4444']}</span>
    `;
    resultsList.appendChild(repRow);

    // Democrat Row
    const demRow = document.createElement('div');
    demRow.className = 'result-row';
    demRow.innerHTML = `
        <div style="display: flex; align-items: center; gap: 1rem;">
            <div class="result-color" style="background-color: #3b82f6"></div>
            <span>Democrat</span>
        </div>
        <span class="result-count" style="color: #3b82f6">${counts['#3b82f6']}</span>
    `;
    resultsList.appendChild(demRow);

    resultsOverlay.classList.remove('hidden');
}

function navigateToStates() {
    renderStates();
}

function navigateToCounties(d) {
    bcCounty.innerText = d.properties.name;
    bcCounty.classList.remove('hidden');
    bcCounty.dataset.level = 'counties';
    document.querySelector('[data-level="states"]').classList.remove('active');
    bcCounty.classList.add('active');
    renderCounties(d);
}

function zoomToFeature(feature) {
    const projection = d3.geoAlbersUsa().scale(width * 1.1).translate([width / 2, height / 2]);
    const path = d3.geoPath().projection(projection);
    const bounds = path.bounds(feature);
    const dx = bounds[1][0] - bounds[0][0];
    const dy = bounds[1][1] - bounds[0][1];
    const x = (bounds[0][0] + bounds[1][0]) / 2;
    const y = (bounds[0][1] + bounds[1][1]) / 2;
    const padding = 0.8;
    const scale = Math.max(1, Math.min(10, padding / Math.max(dx / width, dy / height)));
    const translate = [width / 2 - scale * x, height / 2 - scale * y];

    svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
}

init();
