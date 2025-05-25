// Ensure Day.js plugins are extended (this was in HTML before, better here)
if(window.dayjs && window.dayjs_plugin_customParseFormat && window.dayjs_plugin_duration) {
    dayjs.extend(window.dayjs_plugin_customParseFormat);
    dayjs.extend(window.dayjs_plugin_duration);
} else {
    console.error("Day.js or its plugins failed to load properly before script.js execution.");
}

const yamlPane = document.getElementById('yaml-pane');
const ganttPane = document.getElementById('gantt-pane');
const resizer = document.getElementById('resizer');
const ganttChartTargetContainer = document.getElementById('gantt-chart-target-container');
const ganttChartTargetElement = document.getElementById('gantt-chart-target');
const errorDisplay = document.getElementById('error-display');
const monacoEditorContainer = document.getElementById('monaco-editor-container');
const saveToDiskButton = document.getElementById('save-to-disk-button');
const loadFileInput = document.getElementById('load-file-input');
const shareButton = document.getElementById('share-button');
const mainContainer = document.getElementById('main-container');

let monacoEditor;
let gantt;
let debounceTimer;
const LOCAL_STORAGE_KEY = 'yamlGanttConfig';

let initialYamlPaneWidth = 25;
const savedYamlPaneWidth = localStorage.getItem(LOCAL_STORAGE_KEY + '_yamlWidth');
if(savedYamlPaneWidth) {
    initialYamlPaneWidth = Math.max(15, Math.min(parseFloat(savedYamlPaneWidth), 85));
}

function applyInitialWidths() {
    if(!mainContainer || !resizer || !yamlPane || !ganttPane) {
        console.error("One or more layout elements not found for applyInitialWidths");
        return;
    }
    yamlPane.style.width = `${initialYamlPaneWidth}%`;
    const resizerWidthPx = resizer.offsetWidth;
    const containerWidthPx = mainContainer.offsetWidth;

    if(containerWidthPx > 0) { // Ensure container has a measurable width
        const resizerWidthPercent = (resizerWidthPx / containerWidthPx) * 100;
        ganttPane.style.width = `${100 - initialYamlPaneWidth - resizerWidthPercent}%`;
    } else {
        // Fallback if container width is not yet available (e.g., if called too early)
        // This might happen if script runs before full layout. Consider DOMContentLoaded.
        ganttPane.style.width = `calc(${100 - initialYamlPaneWidth}% - ${resizerWidthPx}px)`;
        console.warn("Main container width was 0 during initial width calculation. Using fallback.");
    }
}

const defaultYaml = `
title: Advanced Features Demo
viewMode: Day # Options: Quarter Day, Half Day, Day, Week, Month

tasks:
  - id: 'phase1'
    name: 'Phase 1: Research & Planning'
    start: '2025-10-01'
    duration: '5d' # Task lasts 5 days
    custom_class: 'bar-activity-stay'

  - id: 'milestone1'
    name: 'Milestone: Plan Approved'
    after: 'phase1' # Starts after phase1 ends
    duration: '0d' # Milestones are often 0 duration
    custom_class: 'bar-milestone'
    dependencies: 'phase1'

  - id: 'devTask1'
    name: 'Development Task 1.1'
    after: 'milestone1'
    duration: '3d'
    custom_class: 'bar-hotel'
    dependencies: 'milestone1'

  - id: 'devTask2'
    name: 'Development Task 1.2 (Parallel)'
    after: 'milestone1' # Can start at the same time as devTask1
    start: '2025-10-09' # Or have a fixed start if known
    duration: '4d'
    custom_class: 'bar-activity'
    dependencies: 'milestone1'

  - id: 'reviewMeeting'
    name: 'Review Meeting'
    start: '2025-10-14 2pm'
    end: '2025-10-14 4pm' # Fixed start and end
    dependencies: 'devTask1, devTask2' # Depends on both
    custom_class: 'bar-flight'

  - id: 'finalPhase'
    name: 'Final Wrap-up'
    after: 'reviewMeeting'
    duration: '1w2d' # Example: 1 week and 2 days
    dependencies: 'reviewMeeting'
    custom_class: 'bar-buffer'
`;

function parseRelaxedDate(dateString) {
    if(!dateString) return null;
    if(typeof dayjs === 'undefined') {
        console.error("Day.js not loaded!");
        return null;
    }
    const formats = [
        'YYYY-MM-DD h:mma', 'YYYY-MM-DD ha', 'YYYY-MM-DD H:mm', 'YYYY-MM-DD HH:mm',
        'YYYY-MM-DD hh:mma', 'YYYY-MM-DD hha', 'YYYY-MM-DD h:mm A', 'YYYY-MM-DD h A',
        'YYYY-MM-DD'
    ];
    let djsDate = dayjs(dateString, formats, true);
    if(!djsDate.isValid()) djsDate = dayjs(dateString);
    return djsDate.isValid() ? djsDate : null;
}

function parseDurationToDayjsDuration(durationStr) {
    if(!durationStr || typeof durationStr !== 'string') return null;
    if(typeof dayjs === 'undefined' || !dayjs.duration) {
        console.error("Day.js duration plugin not loaded!");
        return null;
    }

    let totalMilliseconds = 0;
    // Match formats like "2d", "6h", "30m", "1w", or combinations like "1w2d6h30m"
    const weekMatch = durationStr.match(/(\d+)\s*w/i);
    const dayMatch = durationStr.match(/(\d+)\s*d/i);
    const hourMatch = durationStr.match(/(\d+)\s*h/i);
    const minuteMatch = durationStr.match(/(\d+)\s*m/i);
    const simpleNumberMatch = durationStr.match(/^(\d+)$/);


    if(weekMatch) totalMilliseconds += parseInt(weekMatch[1]) * 7 * 24 * 60 * 60 * 1000;
    if(dayMatch) totalMilliseconds += parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000;
    if(hourMatch) totalMilliseconds += parseInt(hourMatch[1]) * 60 * 60 * 1000;
    if(minuteMatch) totalMilliseconds += parseInt(minuteMatch[1]) * 60 * 1000;

    if(totalMilliseconds === 0 && simpleNumberMatch && !weekMatch && !dayMatch && !hourMatch && !minuteMatch) {
        totalMilliseconds = parseInt(simpleNumberMatch[1]) * 24 * 60 * 60 * 1000; // Assume days if just a number
    }

    return totalMilliseconds > 0 ? dayjs.duration(totalMilliseconds) : null;
}

function preprocessTasks(tasks, parsingErrors) {
    let processedTasks = JSON.parse(JSON.stringify(tasks)); // Deep clone
    const taskMap = new Map(); // For quick lookups

    processedTasks.forEach(task => {
        if(task.id) taskMap.set(task.id, task);
        task.isResolved = false; // Flag to track if start/end are final
    });

    let maxIterations = processedTasks.length + 5; // Limit iterations
    let iterations = 0;
    let changedInPass;

    do {
        changedInPass = false;
        iterations++;
        if(iterations > maxIterations) {
            parsingErrors.push("Could not resolve all 'after' or 'duration' dependencies, possible circular reference or too complex.");
            break;
        }

        processedTasks.forEach(task => {
            if(task.isResolved) return;

            let currentStart, currentEnd;

            // 1. Determine Start Date
            if(task.after) {
                const prevTask = taskMap.get(task.after);
                if(prevTask) {
                    if(prevTask.final_end_date) { // If previous task's end is fully resolved
                        currentStart = dayjs(prevTask.final_end_date);
                        task.start = currentStart.format('YYYY-MM-DD HH:mm:ss'); // Update original task start
                        changedInPass = true;
                    } else {
                        // Previous task not yet fully resolved, skip this task for now
                        return;
                    }
                } else {
                    parsingErrors.push(`Task "${task.name || task.id}" 'after' references non-existent task ID "${task.after}".`);
                    task.start = dayjs().format('YYYY-MM-DD HH:mm:ss'); // Fallback
                }
            }

            currentStart = parseRelaxedDate(task.start);
            if(!currentStart || !currentStart.isValid()) {
                if(!task.after) { // Only error if 'start' was explicit and invalid
                    parsingErrors.push(`Task "${task.name || task.id}" has invalid explicit start date: "${task.start}".`);
                }
                return; // Cannot proceed without a valid start
            }
            task.final_start_date = currentStart.format('YYYY-MM-DD HH:mm:ss');


            // 2. Determine End Date
            if(task.duration) {
                const durationObj = parseDurationToDayjsDuration(task.duration);
                if(durationObj) {
                    currentEnd = currentStart.add(durationObj);
                    task.end = currentEnd.format('YYYY-MM-DD HH:mm:ss'); // Update original task end
                    changedInPass = true;
                } else {
                    parsingErrors.push(`Task "${task.name || task.id}" has invalid duration: "${task.duration}". Defaulting to 1 day.`);
                    currentEnd = currentStart.add(1, 'day'); // Fallback
                    task.end = currentEnd.format('YYYY-MM-DD HH:mm:ss');
                }
            } else if(task.end) {
                currentEnd = parseRelaxedDate(task.end);
                if(!currentEnd || !currentEnd.isValid()) {
                    parsingErrors.push(`Task "${task.name || task.id}" has invalid explicit end date: "${task.end}". Defaulting to start + 1 day.`);
                    currentEnd = currentStart.add(1, 'day'); // Fallback
                    task.end = currentEnd.format('YYYY-MM-DD HH:mm:ss');
                }
            } else {
                parsingErrors.push(`Task "${task.name || task.id}" missing 'end' date or 'duration'. Defaulting to 1 day duration.`);
                currentEnd = currentStart.add(1, 'day'); // Fallback
                task.end = currentEnd.format('YYYY-MM-DD HH:mm:ss');
            }
            task.final_end_date = currentEnd.format('YYYY-MM-DD HH:mm:ss');
            task.isResolved = true; // Mark this task's dates as final for this pass
        });

    } while(changedInPass && iterations <= maxIterations);

    // Final check and format
    return processedTasks.map(task => {
        if(!task.id || !task.name) {
            parsingErrors.push(`A task is missing ID or Name.`);
            return null;
        }
        if(!task.final_start_date || !task.final_end_date) {
            if(!task.after) { // Only push error if it wasn't waiting for an 'after' that never resolved
                parsingErrors.push(`Task "${task.name || task.id}" could not be fully resolved (start/end).`);
            }
            return null;
        }
        return {
            id: String(task.id),
            name: String(task.name),
            start: task.final_start_date,
            end: task.final_end_date,
            dependencies: task.dependencies || '',
            custom_class: task.custom_class || ''
        };
    }).filter(t => t !== null);
}


function renderGantt(yamlString) {
    errorDisplay.style.display = 'none';
    errorDisplay.textContent = '';
    let parsingErrors = [];
    try {
        const config = jsyaml.load(yamlString);
        if(!config || typeof config !== 'object') throw new Error("YAML content is empty or not an object.");

        let tasksFromYaml = config.tasks || [];
        const viewMode = config.viewMode || 'Day';
        const chartTitle = config.title || 'Gantt Chart';

        const headerTitle = document.querySelector('header h1');
        if(headerTitle) headerTitle.textContent = chartTitle + " Live Preview";
        if(!Array.isArray(tasksFromYaml)) throw new Error("'tasks' property must be an array.");

        const processedTasks = preprocessTasks(tasksFromYaml, parsingErrors);

        if(parsingErrors.length > 0) {
            errorDisplay.innerHTML = "Configuration Issues:<br>" + parsingErrors.join("<br>");
            errorDisplay.style.display = 'block';
        }

        ganttChartTargetElement.innerHTML = ''; // Clear previous chart or messages
        if(processedTasks.length === 0) {
            gantt = null;
            const noTaskMsg = document.createElement('p');
            if(tasksFromYaml.length > 0) {
                noTaskMsg.textContent = "No valid tasks to display. Check errors or YAML structure.";
            } else {
                noTaskMsg.textContent = "No tasks defined in YAML.";
            }
            noTaskMsg.style.color = (tasksFromYaml.length > 0 && parsingErrors.length > 0) ? "orange" : "#cccccc";
            noTaskMsg.style.textAlign = "center";
            noTaskMsg.style.paddingTop = "20px";
            ganttChartTargetElement.appendChild(noTaskMsg);
            return;
        }

        // Calculate the earliest start date and latest end date from the tasks
        let earliestStart = null;
        let latestEnd = null;

        processedTasks.forEach(task => {
            const taskStart = dayjs(task.start);
            const taskEnd = dayjs(task.end);

            if(!earliestStart || taskStart.isBefore(earliestStart)) {
                earliestStart = taskStart;
            }

            if(!latestEnd || taskEnd.isAfter(latestEnd)) {
                latestEnd = taskEnd;
            }
        });

        gantt = new Gantt("#gantt-chart-target", processedTasks, {
            start_date: earliestStart.format('YYYY-MM-DD'),
            end_date: latestEnd.format('YYYY-MM-DD'),
            // upper_header_height: 30,
            // lower_header_height: 20,
            // column_width: 300,
            // snap_at: '1d',
            // step: 1,
            // view_modes: ['Quarter Day', 'Half Day', 'Day', 'Week', 'Month'],
            // bar_height: 20,
            // bar_corner_radius: 3,
            // arrow_curve: 5,
            // padding: 18, // Frappe's internal padding for the chart
            view_mode: viewMode,
            date_format: 'YYYY-MM-DD HH:mm:ss',
            language: 'en',
            readonly: true, // Make the chart read-only
            // infinite_padding: true, // Extend timeline infinitely when user scrolls
            popup_on: 'click', // Show popup on click
            // infinite_padding: false,
            lines: 'both',
        });
    } catch(e) {
        console.error("Render Error:", e);
        errorDisplay.textContent = `Render Error: ${e.message}`;
        errorDisplay.style.display = 'block';
        ganttChartTargetElement.innerHTML = `<p style="color:red;text-align:center;padding-top:20px;">Chart Failed.</p>`;
        gantt = null;
    }
}

function uint8ArrayToUrlSafeBase64(uint8Array) {
    let binary = '';
    uint8Array.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function urlSafeBase64ToUint8Array(base64String) {
    base64String = base64String.replace(/-/g, '+').replace(/_/g, '/');
    while(base64String.length % 4) {
        base64String += '=';
    }
    const binary = atob(base64String);
    const uint8Array = new Uint8Array(binary.length);
    for(let i = 0; i < binary.length; i++) {
        uint8Array[i] = binary.charCodeAt(i);
    }
    return uint8Array;
}

require.config({paths: {'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs'}});
let workerProxy = URL.createObjectURL(new Blob([`self.MonacoEnvironment={baseUrl:'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/'};importScripts('https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/base/worker/workerMain.js');`], {type: 'text/javascript'}));
window.MonacoEnvironment = {getWorkerUrl: () => workerProxy};

require(['vs/editor/editor.main'], function() {
    applyInitialWidths(); // Apply widths after DOM is more likely ready
    let initialContent;

    if(window.location.hash && window.location.hash.startsWith('#data=')) {
        const encodedData = window.location.hash.substring(6);
        try {
            const compressedData = urlSafeBase64ToUint8Array(encodedData);
            const decompressedYaml = pako.inflate(compressedData, {to: 'string'});
            initialContent = decompressedYaml;
            history.pushState("", document.title, window.location.pathname + window.location.search);
        } catch(e) {
            console.error("Error decoding/decompressing shared data:", e);
            alert("Could not load shared data from URL.");
            initialContent = localStorage.getItem(LOCAL_STORAGE_KEY) || defaultYaml.trim();
        }
    } else {
        initialContent = localStorage.getItem(LOCAL_STORAGE_KEY) || defaultYaml.trim();
    }

    monacoEditor = monaco.editor.create(monacoEditorContainer, {
        value: initialContent, language: 'yaml', theme: 'vs-dark',
        automaticLayout: true, minimap: {enabled: false}, wordWrap: 'on',
        scrollbar: {verticalScrollbarSize: 10, horizontalScrollbarSize: 10}
    });
    renderGantt(monacoEditor.getValue());

    monacoEditor.onDidChangeModelContent(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const currentYaml = monacoEditor.getValue();
            renderGantt(currentYaml);
            try {
                localStorage.setItem(LOCAL_STORAGE_KEY, currentYaml);
            } catch(e) {
                console.warn("LocalStorage save error:", e);
                errorDisplay.textContent = "Warning: Could not save to local storage.";
                errorDisplay.style.color = "#ffcc00";
                errorDisplay.style.display = 'block';
                setTimeout(() => {
                    errorDisplay.style.display = 'none';
                }, 5000);
            }
        }, 700);
    });

    saveToDiskButton.addEventListener('click', () => {
        if(!monacoEditor) return;
        const yamlContent = monacoEditor.getValue();
        const blob = new Blob([yamlContent], {type: 'text/yaml;charset=utf-8;'});
        const link = document.createElement("a");
        const objectURL = URL.createObjectURL(blob);
        link.setAttribute("href", objectURL);
        link.setAttribute("download", "gantt-config.yaml");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objectURL);
    });

    loadFileInput.addEventListener('change', (event) => {
        if(!monacoEditor) return;
        const file = event.target.files[0];
        if(file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                if(monacoEditor) monacoEditor.setValue(e.target.result);
            };
            reader.onerror = (err) => {
                console.error("File reading error:", err);
                errorDisplay.textContent = "Error reading file: " + err.target.error.name;
                errorDisplay.style.display = 'block';
            };
            reader.readAsText(file);
            event.target.value = null;
        }
    });

    shareButton.addEventListener('click', async () => {
        if(!monacoEditor || typeof pako === 'undefined') {
            alert("Share function not ready or compression library missing.");
            return;
        }
        const yamlContent = monacoEditor.getValue();
        try {
            const compressed = pako.deflate(yamlContent, {level: 9});
            const encoded = uint8ArrayToUrlSafeBase64(compressed);
            const shareUrl = `${window.location.origin}${window.location.pathname}#data=${encoded}`;

            await navigator.clipboard.writeText(shareUrl);
            const originalButtonText = shareButton.textContent;
            shareButton.textContent = "Copied!";
            shareButton.disabled = true;
            setTimeout(() => {
                shareButton.textContent = originalButtonText;
                shareButton.disabled = false;
            }, 2000);
        } catch(e) {
            console.error("Error creating share link:", e);
            alert("Could not create share link: " + e.message);
        }
    });

    document.addEventListener('keydown', function(event) {
        if(event.ctrlKey || event.metaKey) {
            if(event.key === 's' || event.key === 'S') {
                event.preventDefault();
                saveToDiskButton.click();
            } else if(event.key === 'o' || event.key === 'O') {
                event.preventDefault();
                loadFileInput.click();
            }
        }
    });

    // --- Resizer Logic ---
    let isResizing = false;
    let dragStartX;
    let initialLeftWidth;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        dragStartX = e.clientX;
        initialLeftWidth = yamlPane.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        // Add listeners to document to capture mouse move everywhere
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
    });

    function handleDragMove(e) {
        if(!isResizing) return;

        const dx = e.clientX - dragStartX;
        let newLeftWidth = initialLeftWidth + dx;

        const containerWidth = mainContainer.offsetWidth;
        const resizerWidth = resizer.offsetWidth;

        // Constraints
        const minPaneWidth = containerWidth * 0.15; // 15% min width
        const maxPaneWidth = containerWidth * 0.85; // 85% max width

        newLeftWidth = Math.max(minPaneWidth, Math.min(newLeftWidth, maxPaneWidth - resizerWidth));

        const newLeftWidthPercent = (newLeftWidth / containerWidth) * 100;
        const newRightWidthPercent = 100 - newLeftWidthPercent - (resizerWidth / containerWidth * 100);

        yamlPane.style.width = `${newLeftWidthPercent}%`;
        ganttPane.style.width = `${newRightWidthPercent}%`;

        if(monacoEditor) {
            monacoEditor.layout(); // Monaco needs to be told to relayout
        }
        // Frappe Gantt usually reflows if its container size changes,
        // but if not, a call to gantt.refresh() or re-render might be needed.
        // However, re-rendering on every mouse move is too slow.
    }

    function handleDragEnd() {
        if(!isResizing) return;
        isResizing = false;
        document.body.style.cursor = 'default';
        document.body.style.userSelect = '';

        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);

        // Save the new width
        const currentYamlWidthPercent = (yamlPane.offsetWidth / mainContainer.offsetWidth) * 100;
        localStorage.setItem(LOCAL_STORAGE_KEY + '_yamlWidth', currentYamlWidthPercent.toFixed(2));

        if(monacoEditor) {
            monacoEditor.layout(); // Final layout call
        }
    }
});
