// Ensure Day.js plugins are extended
if (window.dayjs &&
    window.dayjs_plugin_customParseFormat &&
    window.dayjs_plugin_duration &&
    window.dayjs_plugin_isoWeek) {
    dayjs.extend(window.dayjs_plugin_customParseFormat);
    dayjs.extend(window.dayjs_plugin_duration);
    dayjs.extend(window.dayjs_plugin_isoWeek);
} else {
    console.error("Day.js or one of its required plugins (customParseFormat, duration, isoWeek) failed to load properly before script.js execution.");
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
let debounceTimer;
const LOCAL_STORAGE_KEY = 'yamlGanttConfig';

// --- Resizing constants ---
const LABEL_COLUMN_WIDTH_PX = 240;   // CHANGED: Increased label column width
const DAY_COLUMN_WIDTH_PX = 288;
const ROW_HEIGHT_PX = 28;
const BAR_HEIGHT_PX = 20;
const MILESTONE_WIDTH_PX = 12;

let initialYamlPaneWidth = 35;
const savedYamlPaneWidth = localStorage.getItem(LOCAL_STORAGE_KEY + '_yamlWidth');
if (savedYamlPaneWidth) {
    initialYamlPaneWidth = Math.max(15, Math.min(parseFloat(savedYamlPaneWidth), 85));
}

function applyInitialWidths() {
    // ... (no changes in this function)
    if (!mainContainer || !resizer || !yamlPane || !ganttPane) {
        console.error("One or more layout elements not found for applyInitialWidths");
        return;
    }
    yamlPane.style.width = `${initialYamlPaneWidth}%`;
    const resizerWidthPx = resizer.offsetWidth;
    const containerWidthPx = mainContainer.offsetWidth;

    if (containerWidthPx > 0) {
        const resizerWidthPercent = (resizerWidthPx / containerWidthPx) * 100;
        ganttPane.style.width = `${100 - initialYamlPaneWidth - resizerWidthPercent}%`;
    } else {
        ganttPane.style.width = `calc(${100 - initialYamlPaneWidth}% - ${resizerWidthPx}px)`;
        console.warn("Main container width was 0 during initial width calculation. Using fallback.");
    }
}

const defaultYaml = `
title: Wide Column Gantt - Time Demo
viewMode: Day # Options: Day, Week, Month

tasks:
  - id: 'meeting_am'
    name: 'Morning Strategy Meeting'
    start: '2024-07-18 9:00am'
    end: '2024-07-18 11:30am'
    custom_class: 'bar-blue'

  - id: 'lunch_break'
    name: 'Lunch Break'
    after: 'meeting_am'
    duration: '1h'
    custom_class: 'bar-grey'

  - id: 'afternoon_work'
    name: 'Focused Work Block'
    after: 'lunch_break'
    duration: '3h30m'
    custom_class: 'bar-green'
  
  - id: 'quick_sync'
    name: 'Quick Team Sync'
    start: '2024-07-18 4:00pm'
    duration: '30m'
    custom_class: 'bar-orange'

  - id: 'long_task'
    name: 'Multi-day Design Phase'
    start: '2024-07-19'
    duration: '2d8h' # 2 days and 8 hours
    custom_class: 'bar-purple'

  - id: 'milestone_done'
    name: 'End of Day Milestone'
    after: 'quick_sync'
    start: '2024-07-18 5:00pm' # explicit start for milestone
    duration: '0d' 
    custom_class: 'bar-milestone bar-red'
`;

function parseRelaxedDate(dateString) {
    // ... (no changes in this function)
    if (!dateString) return null;
    if (typeof dayjs === 'undefined') {
        console.error("Day.js not loaded!");
        return null;
    }
    const formats = [
        'YYYY-MM-DD h:mma', 'YYYY-MM-DD ha', 'YYYY-MM-DD H:mm', 'YYYY-MM-DD HH:mm',
        'YYYY-MM-DD hh:mma', 'YYYY-MM-DD hha', 'YYYY-MM-DD h:mm A', 'YYYY-MM-DD h A',
        'YYYY-MM-DD'
    ];
    let djsDate = dayjs(dateString, formats, true);
    if (!djsDate.isValid()) djsDate = dayjs(dateString);
    return djsDate.isValid() ? djsDate : null;
}

function parseDurationToDayjsDuration(durationStr) {
    // ... (no changes in this function)
    if (!durationStr || typeof durationStr !== 'string') return null;
    if (typeof dayjs === 'undefined' || !dayjs.duration) {
        console.error("Day.js duration plugin not loaded!");
        return null;
    }

    let totalMilliseconds = 0;
    const weekMatch = durationStr.match(/(\d+)\s*w/i);
    const dayMatch = durationStr.match(/(\d+)\s*d/i);
    const hourMatch = durationStr.match(/(\d+)\s*h/i);
    const minuteMatch = durationStr.match(/(\d+)\s*m/i);
    const simpleNumberMatch = durationStr.match(/^(\d+)$/);


    if (weekMatch) totalMilliseconds += parseInt(weekMatch[1]) * 7 * 24 * 60 * 60 * 1000;
    if (dayMatch) totalMilliseconds += parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000;
    if (hourMatch) totalMilliseconds += parseInt(hourMatch[1]) * 60 * 60 * 1000;
    if (minuteMatch) totalMilliseconds += parseInt(minuteMatch[1]) * 60 * 1000;

    if (totalMilliseconds === 0 && simpleNumberMatch && !weekMatch && !dayMatch && !hourMatch && !minuteMatch) {
        totalMilliseconds = parseInt(simpleNumberMatch[1]) * 24 * 60 * 60 * 1000; // Assume days if just a number
    }

    return dayjs.duration(totalMilliseconds);
}

function preprocessTasks(tasks, parsingErrors) {
    // ... (no changes in this function)
    let processedTasks = JSON.parse(JSON.stringify(tasks));
    const taskMap = new Map();

    processedTasks.forEach(task => {
        if (task.id) taskMap.set(task.id, task);
        task.isResolved = false;
    });

    let maxIterations = processedTasks.length * 2 + 5;
    let iterations = 0;
    let changedInPass;

    do {
        changedInPass = false;
        iterations++;
        if (iterations > maxIterations) {
            parsingErrors.push("Could not resolve all 'after' or 'duration' dependencies, possible circular reference or complex chain. Some tasks may be misplaced.");
            processedTasks.forEach(task => { if (!task.isResolved) task.preprocess_failed = true; });
            break;
        }

        processedTasks.forEach(task => {
            if (task.isResolved || task.preprocess_failed) return;

            let currentStart, currentEnd;

            if (task.after) {
                const prevTaskIds = String(task.after).split(',').map(id => id.trim());
                let latestPrevTaskEndDate = null;
                let allDepsResolved = true;

                for (const prevId of prevTaskIds) {
                    const prevTask = taskMap.get(prevId);
                    if (prevTask) {
                        if (prevTask.final_end_date) {
                            const prevEnd = dayjs(prevTask.final_end_date);
                            if (!latestPrevTaskEndDate || prevEnd.isAfter(latestPrevTaskEndDate)) {
                                latestPrevTaskEndDate = prevEnd;
                            }
                        } else {
                            allDepsResolved = false;
                            break;
                        }
                    } else {
                        parsingErrors.push(`Task "${task.name || task.id}" 'after' references non-existent task ID "${prevId}".`);
                    }
                }

                if (allDepsResolved && latestPrevTaskEndDate) {
                    currentStart = latestPrevTaskEndDate;
                    const explicitStart = parseRelaxedDate(task.start);
                    if (explicitStart && explicitStart.isAfter(currentStart)) {
                        currentStart = explicitStart;
                    }
                    task.start = currentStart.format('YYYY-MM-DD HH:mm:ss');
                    changedInPass = true;
                } else if (!allDepsResolved) {
                    return;
                } else if (!task.start) {
                    parsingErrors.push(`Task "${task.name || task.id}" has 'after' dependency but it could not be resolved, and no explicit start. Defaulting to now.`);
                    task.start = dayjs().format('YYYY-MM-DD HH:mm:ss');
                }
            }

            currentStart = parseRelaxedDate(task.start);
            if (!currentStart || !currentStart.isValid()) {
                if (!task.after) {
                    parsingErrors.push(`Task "${task.name || task.id}" has invalid or missing start date: "${task.start}". Defaulting to now.`);
                } else if (task.after && !currentStart) {
                    parsingErrors.push(`Task "${task.name || task.id}" failed to get start date from 'after' and explicit start "${task.start}" is invalid. Defaulting to now.`);
                }
                currentStart = dayjs();
                task.start = currentStart.format('YYYY-MM-DD HH:mm:ss');
            }
            task.final_start_date = currentStart.format('YYYY-MM-DD HH:mm:ss');

            if (task.duration) {
                const durationObj = parseDurationToDayjsDuration(task.duration);
                if (durationObj) {
                    currentEnd = currentStart.add(durationObj);
                    const oldEnd = task.end;
                    task.end = currentEnd.format('YYYY-MM-DD HH:mm:ss');
                    if (task.end !== oldEnd) changedInPass = true;
                } else {
                    parsingErrors.push(`Task "${task.name || task.id}" has invalid duration: "${task.duration}". Defaulting to 0 duration (milestone).`);
                    currentEnd = currentStart;
                    task.end = currentEnd.format('YYYY-MM-DD HH:mm:ss');
                    changedInPass = true;
                }
            } else if (task.end) {
                currentEnd = parseRelaxedDate(task.end);
                if (!currentEnd || !currentEnd.isValid()) {
                    parsingErrors.push(`Task "${task.name || task.id}" has invalid explicit end date: "${task.end}". Defaulting to start time (milestone).`);
                    currentEnd = currentStart;
                    task.end = currentEnd.format('YYYY-MM-DD HH:mm:ss');
                    changedInPass = true;
                } else if (currentEnd.isBefore(currentStart)) {
                    parsingErrors.push(`Task "${task.name || task.id}" end date is before start date. Adjusting end to start time (milestone).`);
                    currentEnd = currentStart;
                    task.end = currentEnd.format('YYYY-MM-DD HH:mm:ss');
                    changedInPass = true;
                }
            } else {
                parsingErrors.push(`Task "${task.name || task.id}" missing 'end' date or 'duration'. Defaulting to 0 duration (milestone).`);
                currentEnd = currentStart;
                task.end = currentEnd.format('YYYY-MM-DD HH:mm:ss');
                changedInPass = true;
            }
            task.final_end_date = currentEnd.format('YYYY-MM-DD HH:mm:ss');
            task.isResolved = true;
        });

    } while (changedInPass && iterations <= maxIterations);

    return processedTasks.map(task => {
        if (task.preprocess_failed) return null;
        if (!task.id || !task.name) {
            parsingErrors.push(`A task is missing ID or Name.`);
            return null;
        }
        if (!task.final_start_date || !task.final_end_date) {
            parsingErrors.push(`Task "${task.name || task.id}" could not be fully resolved (start/end).`);
            return null;
        }
        let dependenciesString = '';
        if (task.dependencies) {
            if (Array.isArray(task.dependencies)) dependenciesString = task.dependencies.join(',');
            else dependenciesString = String(task.dependencies);
        }

        return {
            id: String(task.id),
            name: String(task.name),
            start: task.final_start_date,
            end: task.final_end_date,
            dependencies: dependenciesString,
            custom_class: task.custom_class || ''
        };
    }).filter(t => t !== null);
}

function createTimelineHeader(overallMinDate, overallMaxDate, viewMode, totalPixelWidth) {
    // ... (no changes in this function)
    const headerContainer = document.createElement('div');
    headerContainer.className = 'gantt-html-timeline-header-container';
    headerContainer.style.height = `${ROW_HEIGHT_PX * 2}px`;

    const timelineLabels = document.createElement('div');
    timelineLabels.className = 'gantt-html-timeline-labels';
    timelineLabels.style.width = `${LABEL_COLUMN_WIDTH_PX}px`;
    timelineLabels.innerHTML = `<div>Dates</div><div>Tasks</div>`;

    const timelineTicksOuter = document.createElement('div');
    timelineTicksOuter.className = 'gantt-html-timeline-ticks-outer';
    timelineTicksOuter.style.minWidth = `${totalPixelWidth}px`;

    const timelineTicksMajor = document.createElement('div');
    timelineTicksMajor.className = 'gantt-html-timeline-ticks major';
    timelineTicksMajor.style.height = `${ROW_HEIGHT_PX}px`;

    const timelineTicksMinor = document.createElement('div');
    timelineTicksMinor.className = 'gantt-html-timeline-ticks minor';
    timelineTicksMinor.style.height = `${ROW_HEIGHT_PX}px`;

    let currentDate = dayjs(overallMinDate).startOf('day');
    const projectTimelineEndDate = dayjs(overallMaxDate).endOf('day');

    let currentMonth = -1;
    let currentWeek = -1;
    const projectStartDateForDiff = dayjs(overallMinDate).startOf('day');

    while (currentDate.isBefore(projectTimelineEndDate) || currentDate.isSame(projectTimelineEndDate, 'day')) {
        const dayTick = document.createElement('div');
        dayTick.className = 'gantt-html-tick';
        dayTick.style.width = `${DAY_COLUMN_WIDTH_PX}px`;
        dayTick.textContent = currentDate.format('D');

        const dayIndexForStripe = currentDate.diff(projectStartDateForDiff, 'days');
        dayTick.classList.add(dayIndexForStripe % 2 === 0 ? 'gantt-day-stripe-even' : 'gantt-day-stripe-odd');
        timelineTicksMinor.appendChild(dayTick);

        const firstDayInTimelineHeaderLoop = projectStartDateForDiff.isSame(currentDate, 'day');

        if (viewMode === 'Month' || viewMode === 'Week') {
            if (currentDate.month() !== currentMonth || firstDayInTimelineHeaderLoop) {
                currentMonth = currentDate.month();
                const monthTick = document.createElement('div');
                monthTick.className = 'gantt-html-tick major-tick';

                const startOfMonthInView = firstDayInTimelineHeaderLoop ? currentDate.clone() : currentDate.clone().startOf('month');
                let endOfMonthInView = currentDate.clone().endOf('month');
                if (endOfMonthInView.isAfter(projectTimelineEndDate)) {
                    endOfMonthInView = projectTimelineEndDate.clone();
                }

                const daysInMonthSpan = endOfMonthInView.diff(startOfMonthInView, 'days') + 1;
                monthTick.style.width = `${daysInMonthSpan * DAY_COLUMN_WIDTH_PX}px`;
                monthTick.textContent = currentDate.format('MMM YYYY');
                timelineTicksMajor.appendChild(monthTick);
            }
        } else {
            if (currentDate.isoWeek() !== currentWeek || firstDayInTimelineHeaderLoop) {
                currentWeek = currentDate.isoWeek();
                const weekTick = document.createElement('div');
                weekTick.className = 'gantt-html-tick major-tick';

                const startOfWeekInView = firstDayInTimelineHeaderLoop ? currentDate.clone() : currentDate.clone().startOf('isoWeek');
                let endOfWeekInView = currentDate.clone().endOf('isoWeek');
                if (endOfWeekInView.isAfter(projectTimelineEndDate)) {
                    endOfWeekInView = projectTimelineEndDate.clone();
                }

                const daysInWeekSpan = endOfWeekInView.diff(startOfWeekInView, 'days') + 1;
                weekTick.style.width = `${daysInWeekSpan * DAY_COLUMN_WIDTH_PX}px`;
                weekTick.textContent = `W${currentDate.isoWeek()}`;
                timelineTicksMajor.appendChild(weekTick);
            }
        }
        currentDate = currentDate.add(1, 'day');
    }

    timelineTicksOuter.appendChild(timelineTicksMajor);
    timelineTicksOuter.appendChild(timelineTicksMinor);

    headerContainer.appendChild(timelineLabels);
    headerContainer.appendChild(timelineTicksOuter);
    return headerContainer;
}

function formatDuration(durationMilliseconds) {
    if (durationMilliseconds < 0) durationMilliseconds = 0;
    const totalMinutes = Math.floor(durationMilliseconds / (1000 * 60));
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);

    if (durationMilliseconds < (24 * 60 * 60 * 1000)) { // Less than 24 hours
        const hours = totalHours % 24;
        const minutes = totalMinutes % 60;
        let durationStr = "";
        if (hours > 0) durationStr += `${hours}h `;
        if (minutes > 0 || (hours === 0 && minutes === 0 && durationMilliseconds > 0) || (hours === 0 && minutes === 0 && durationMilliseconds === 0 && totalMinutes === 0)) { // show 0m if no hours and 0 minutes
            durationStr += `${minutes}m`;
        }
        return durationStr.trim() || "0m"; // Ensure "0m" if completely zero
    } else {
        const hours = totalHours % 24;
        let durationStr = `${days}d`;
        if (hours > 0) {
            durationStr += ` ${hours}h`;
        }
        return durationStr;
    }
}


function renderGantt(yamlString) {
    errorDisplay.style.display = 'none';
    errorDisplay.textContent = '';
    let parsingErrors = [];

    try {
        const config = jsyaml.load(yamlString);
        if (!config || typeof config !== 'object') throw new Error("YAML content is empty or not an object.");

        let tasksFromYaml = config.tasks || [];
        const viewMode = config.viewMode || 'Day';
        const chartTitle = config.title || 'Gantt Chart';

        const headerTitle = document.querySelector('header h1');
        if (headerTitle) headerTitle.textContent = chartTitle + " Live Preview";
        document.title = chartTitle;

        if (!Array.isArray(tasksFromYaml)) throw new Error("'tasks' property must be an array.");

        const processedTasks = preprocessTasks(tasksFromYaml, parsingErrors);

        if (parsingErrors.length > 0) {
            errorDisplay.innerHTML = "Configuration Issues:<br>" + parsingErrors.join("<br>");
            errorDisplay.style.display = 'block';
        }

        ganttChartTargetElement.innerHTML = '';

        if (processedTasks.length === 0) {
            const noTaskMsg = document.createElement('p');
            noTaskMsg.className = 'gantt-message';
            if (tasksFromYaml.length > 0 && parsingErrors.length > 0) {
                noTaskMsg.textContent = "No valid tasks to display. Check errors or YAML structure.";
            } else {
                noTaskMsg.textContent = "No tasks defined in YAML.";
            }
            ganttChartTargetElement.appendChild(noTaskMsg);
            return;
        }

        let overallMinDate = null;
        let overallMaxDate = null;

        processedTasks.forEach(task => {
            const taskStart = dayjs(task.start);
            const taskEnd = dayjs(task.end);
            if (!overallMinDate || taskStart.isBefore(overallMinDate)) overallMinDate = taskStart;
            if (!overallMaxDate || taskEnd.isAfter(overallMaxDate)) overallMaxDate = taskEnd;
        });

        if (overallMinDate && overallMaxDate && overallMinDate.isSame(overallMaxDate, 'day') && dayjs(overallMaxDate).diff(overallMinDate, 'ms') === 0) {
            // If it's a single point in time (like a single milestone), expand by one day for visual rendering
            overallMaxDate = dayjs(overallMinDate).add(1, 'day');
        } else if (overallMinDate && overallMaxDate && overallMinDate.isSame(overallMaxDate, 'day')) {
            // If start and end are on the same day but different times, ensure timeline still covers at least one full day block
            overallMaxDate = dayjs(overallMinDate).endOf('day'); // Ensure the max date covers the full day if tasks are within it
        }


        if (!overallMinDate || !overallMaxDate) {
            ganttChartTargetElement.innerHTML = '<p class="gantt-message">Could not determine date range for tasks.</p>';
            return;
        }

        const viewableTimelineStartDate = dayjs(overallMinDate).startOf('day');
        // Ensure the timeline end date covers the entirety of the last day tasks might touch
        const viewableTimelineEndDate = dayjs(overallMaxDate).isSame(dayjs(overallMaxDate).startOf('day')) && dayjs(overallMaxDate).diff(overallMinDate,'ms') !== 0 ?
            dayjs(overallMaxDate).subtract(1, 'millisecond').startOf('day') : // If overallMax is exactly start of a day (and not same as min)
            dayjs(overallMaxDate).startOf('day');


        const numTimelineDays = viewableTimelineEndDate.diff(viewableTimelineStartDate, 'days') + 1;
        const totalPixelWidth = numTimelineDays * DAY_COLUMN_WIDTH_PX;

        const ganttTable = document.createElement('div');
        ganttTable.className = 'gantt-html-table';

        const timelineHeaderElement = createTimelineHeader(viewableTimelineStartDate, viewableTimelineEndDate, viewMode, totalPixelWidth);
        ganttTable.appendChild(timelineHeaderElement);

        const tasksContainer = document.createElement('div');
        tasksContainer.className = 'gantt-html-tasks-container';

        processedTasks.forEach((task, index) => {
            const taskRow = document.createElement('div');
            taskRow.className = 'gantt-html-task-row';
            taskRow.style.height = `${ROW_HEIGHT_PX}px`;

            const taskLabel = document.createElement('div');
            taskLabel.className = 'gantt-html-task-label';
            taskLabel.style.width = `${LABEL_COLUMN_WIDTH_PX}px`;
            taskLabel.textContent = task.name;
            taskLabel.title = task.name;

            const taskScheduleCell = document.createElement('div');
            taskScheduleCell.className = 'gantt-html-task-schedule-cell';
            taskScheduleCell.style.minWidth = `${totalPixelWidth}px`;

            for (let i = 0; i < numTimelineDays; i++) {
                const dayStripe = document.createElement('div');
                dayStripe.classList.add(i % 2 === 0 ? 'gantt-day-stripe-even' : 'gantt-day-stripe-odd');
                dayStripe.style.position = 'absolute';
                dayStripe.style.left = `${i * DAY_COLUMN_WIDTH_PX}px`;
                dayStripe.style.top = '0';
                dayStripe.style.width = `${DAY_COLUMN_WIDTH_PX}px`;
                dayStripe.style.height = '100%';
                taskScheduleCell.appendChild(dayStripe);
            }

            const taskBar = document.createElement('div');
            taskBar.className = 'gantt-html-task-bar';
            taskBar.style.height = `${BAR_HEIGHT_PX}px`;
            taskBar.style.top = `${(ROW_HEIGHT_PX - BAR_HEIGHT_PX) / 2}px`;

            if (task.custom_class) {
                task.custom_class.split(' ').forEach(cls => {
                    if (cls) taskBar.classList.add(cls.trim());
                });
            }

            const taskStart = dayjs(task.start);
            const taskEnd = dayjs(task.end);

            const offsetMilliseconds = taskStart.diff(viewableTimelineStartDate, 'milliseconds');
            const durationMilliseconds = taskEnd.diff(taskStart, 'milliseconds');

            const offsetDaysFractional = offsetMilliseconds / (24 * 60 * 60 * 1000);
            const durationDaysFractional = durationMilliseconds / (24 * 60 * 60 * 1000);

            let barLeftPx = offsetDaysFractional * DAY_COLUMN_WIDTH_PX;
            let barWidthPx = durationDaysFractional * DAY_COLUMN_WIDTH_PX;

            // Format times for title
            const formattedStartTime = taskStart.format('MMM D, YYYY h:mma'); // CHANGED: 12hr format
            const formattedEndTime = taskEnd.format('MMM D, YYYY h:mma');   // CHANGED: 12hr format
            const formattedDuration = formatDuration(durationMilliseconds); // CHANGED: Use new helper

            if (durationMilliseconds <= 0) { // Milestone
                taskBar.classList.add('gantt-milestone');
                barWidthPx = MILESTONE_WIDTH_PX;
                // Center milestone: start of its time + half day width - half milestone width
                barLeftPx = (offsetDaysFractional * DAY_COLUMN_WIDTH_PX) - (MILESTONE_WIDTH_PX / 2);
                if(DAY_COLUMN_WIDTH_PX > MILESTONE_WIDTH_PX) { // Only add if day col is wider
                    barLeftPx += DAY_COLUMN_WIDTH_PX * (taskStart.hour() / 24 + taskStart.minute() / (24*60));
                }
                taskBar.title = `${task.name} (Milestone)\n${formattedStartTime}`;
            } else {
                taskBar.title = `${task.name}\nStart: ${formattedStartTime}\nEnd: ${formattedEndTime}\nDuration: ${formattedDuration}`;
            }

            taskBar.style.left = `${Math.max(0, barLeftPx)}px`;
            taskBar.style.width = `${Math.max(2, barWidthPx)}px`; // Min 2px width for visibility

            taskScheduleCell.appendChild(taskBar);
            taskRow.appendChild(taskLabel);
            taskRow.appendChild(taskScheduleCell);
            tasksContainer.appendChild(taskRow);
        });

        ganttTable.appendChild(tasksContainer);
        ganttChartTargetElement.appendChild(ganttTable);

    } catch (e) {
        console.error("Render Error:", e);
        errorDisplay.textContent = `Render Error: ${e.message}\n${e.stack}`;
        errorDisplay.style.display = 'block';
        ganttChartTargetElement.innerHTML = `<p class="gantt-message error">Chart Failed to Render.</p>`;
    }
}


function uint8ArrayToUrlSafeBase64(uint8Array) { /* ... (no changes) ... */
    let binary = '';
    uint8Array.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function urlSafeBase64ToUint8Array(base64String) { /* ... (no changes) ... */
    base64String = base64String.replace(/-/g, '+').replace(/_/g, '/');
    while (base64String.length % 4) {
        base64String += '=';
    }
    const binary = atob(base64String);
    const uint8Array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        uint8Array[i] = binary.charCodeAt(i);
    }
    return uint8Array;
}

require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
let workerProxy = URL.createObjectURL(new Blob([`self.MonacoEnvironment={baseUrl:'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/'};importScripts('https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/base/worker/workerMain.js');`], { type: 'text/javascript' }));
window.MonacoEnvironment = { getWorkerUrl: () => workerProxy };

require(['vs/editor/editor.main'], function () { /* ... (no changes to this block of code) ... */
    applyInitialWidths();
    let initialContent;

    if (window.location.hash && window.location.hash.startsWith('#data=')) {
        const encodedData = window.location.hash.substring(6);
        try {
            const compressedData = urlSafeBase64ToUint8Array(encodedData);
            const decompressedYaml = pako.inflate(compressedData, { to: 'string' });
            initialContent = decompressedYaml;
            history.pushState("", document.title, window.location.pathname + window.location.search);
        } catch (e) {
            console.error("Error decoding/decompressing shared data:", e);
            alert("Could not load shared data from URL.");
            initialContent = localStorage.getItem(LOCAL_STORAGE_KEY) || defaultYaml.trim();
        }
    } else {
        initialContent = localStorage.getItem(LOCAL_STORAGE_KEY) || defaultYaml.trim();
    }

    monacoEditor = monaco.editor.create(monacoEditorContainer, {
        value: initialContent, language: 'yaml', theme: 'vs-dark',
        automaticLayout: true, minimap: { enabled: false }, wordWrap: 'on',
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
    });
    renderGantt(monacoEditor.getValue());

    monacoEditor.onDidChangeModelContent(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const currentYaml = monacoEditor.getValue();
            renderGantt(currentYaml);
            try {
                localStorage.setItem(LOCAL_STORAGE_KEY, currentYaml);
            } catch (e) {
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
        if (!monacoEditor) return;
        const yamlContent = monacoEditor.getValue();
        const blob = new Blob([yamlContent], { type: 'text/yaml;charset=utf-8;' });
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
        if (!monacoEditor) return;
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (monacoEditor) monacoEditor.setValue(e.target.result);
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
        if (!monacoEditor || typeof pako === 'undefined') {
            alert("Share function not ready or compression library missing.");
            return;
        }
        const yamlContent = monacoEditor.getValue();
        try {
            const compressed = pako.deflate(yamlContent, { level: 9 });
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
        } catch (e) {
            console.error("Error creating share link:", e);
            alert("Could not create share link: " + e.message);
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.ctrlKey || event.metaKey) {
            if (event.key === 's' || event.key === 'S') {
                event.preventDefault();
                saveToDiskButton.click();
            } else if (event.key === 'o' || event.key === 'O') {
                event.preventDefault();
                loadFileInput.click();
            }
        }
    });

    let isResizing = false;
    let dragStartX;
    let initialLeftWidth;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        dragStartX = e.clientX;
        initialLeftWidth = yamlPane.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
    });

    function handleDragMove(e) {
        if (!isResizing) return;
        const dx = e.clientX - dragStartX;
        let newLeftWidth = initialLeftWidth + dx;
        const containerWidth = mainContainer.offsetWidth;
        const resizerWidth = resizer.offsetWidth;
        const minPaneWidth = containerWidth * 0.15;
        const maxPaneWidth = containerWidth * 0.85;
        newLeftWidth = Math.max(minPaneWidth, Math.min(newLeftWidth, maxPaneWidth - resizerWidth));
        const newLeftWidthPercent = (newLeftWidth / containerWidth) * 100;
        const newRightWidthPercent = 100 - newLeftWidthPercent - (resizerWidth / containerWidth * 100);
        yamlPane.style.width = `${newLeftWidthPercent}%`;
        ganttPane.style.width = `${newRightWidthPercent}%`;
        if (monacoEditor) monacoEditor.layout();
    }

    function handleDragEnd() {
        if (!isResizing) return;
        isResizing = false;
        document.body.style.cursor = 'default';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
        const currentYamlWidthPercent = (yamlPane.offsetWidth / mainContainer.offsetWidth) * 100;
        localStorage.setItem(LOCAL_STORAGE_KEY + '_yamlWidth', currentYamlWidthPercent.toFixed(2));
        if (monacoEditor) monacoEditor.layout();
    }
});
