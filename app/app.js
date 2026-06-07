/* ============================================================
   Engineer Scheduler Widget – app.js v2
   Uses ZOHO.CRM.API as primary
   ============================================================ */

const MODULES = {
  ENGINEERS: 'Engineers',
  SCHEDULES: 'Schedules'
};

const FIELD = {
  ENGINEERS: { NAME:'Name', SKILLS:'Skills', STATUS:'Status', POSITION:'Position', ID:'id' },
  SCHEDULES: { NAME:'Name', DATE:'Date', END_TIME:'End_time', START_TIME:'Start_time', ENGINEERS:'Engineers', ID:'id' }
};

// Linking module to link Schedules ↔ Engineers
// From metadata: multiselectlookup.api_name = "Engineers22", linking_module.api_name = "Schedules_X_Engineers2"
const LINKING_MODULE = 'Schedules_X_Engineers2';
const LINK_FIELD_SCHEDULE = 'Schedules'; // lookup to Schedules in linking module
const LINK_FIELD_ENGINEER = 'Engineers'; // lookup to Engineers in linking module


// State
let allEngineers = [];
let allSchedules = [];
let allLinks = [];
let skillOptions = [];
let filteredEngineers = [];
let selectedIds = new Set();
let activeScheduleId = null;  // ID of selected schedule or newly created

const $ = id => document.getElementById(id);
const dom = {
  headerSub:     $('headerSub'),
  headerBadge:   $('headerBadge'),
  scheduleSelect:$('scheduleSelect'),
  newSchedName: $('newScheduleName'),
  filterDate:    $('filterDate'),
  filterStart:   $('filterStartTime'),
  filterEnd:     $('filterEndTime'),
  filterSkill:   $('filterSkill'),
  btnFilter:     $('btnFilter'),
  tbody:         $('engineersBody'),
  selectAll:     $('selectAll'),
  selectionBar:  $('selectionBar'),
  selectedCount: $('selectedCount'),
  selectedNames: $('selectedNames'),
  scheduleSec:   $('scheduleSection'),
  btnAssign:     $('btnAssign'),
  btnUnlink:     $('btnUnlink'),
  showAll:       $('showAll'),
  btnReschedule: $('btnReschedule'),
  toast:         $('toast'),
  loader:        $('loader'),
  loaderText:    $('loaderText')
};

function showLoader(t) { dom.loaderText.textContent = t||'Loading...'; dom.loader.style.display='flex'; }
function hideLoader() { dom.loader.style.display='none'; }

let toastTimer = null;
function showToast(msg, type) {
  if (toastTimer) clearTimeout(toastTimer);
  dom.toast.textContent = msg;
  dom.toast.className = 'toast '+(type||'success');
  dom.toast.classList.add('show');
  toastTimer = setTimeout(()=>dom.toast.classList.remove('show'), 3500);
}

function escapeHtml(t) {
  if (!t) return '';
  return String(t).replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"');
}

// ─── API helpers ──────────────────────────────────────────

function apiGetAllRecords(entity, page, perPage) {
  return new Promise((resolve, reject) => {
    var cfg = { Entity: entity, page: page||1, per_page: perPage||200 };
    console.log('[API] getAllRecords', JSON.stringify(cfg));
    ZOHO.CRM.API.getAllRecords(cfg).then(r => {
      console.log('[API] getAllRecords result for', entity, r);
      resolve(r && r.data ? r.data : []);
    }).catch(e => { console.error('[API] getAllRecords error', e); reject(e); });
  });
}

function apiInsertRecord(entity, data, triggers) {
  return new Promise((resolve, reject) => {
    var cfg = { Entity: entity, APIData: data, Trigger: triggers||[] };
    console.log('[API] insertRecord', JSON.stringify(cfg,null,2));
    ZOHO.CRM.API.insertRecord(cfg).then(r => { console.log('[API] insertRecord result', r); resolve(r); }).catch(e => { console.error('[API] insertRecord error', e); reject(e); });
  });
}

function apiDeleteRecord(entity, recordId) {
  return new Promise((resolve, reject) => {
    var cfg = { Entity: entity, RecordID: recordId };
    console.log('[API] deleteRecord', JSON.stringify(cfg));
    ZOHO.CRM.API.deleteRecord(cfg).then(r => { console.log('[API] deleteRecord result', r); resolve(r); }).catch(e => { console.error('[API] deleteRecord error', e); reject(e); });
  });
}

function apiUpdateRecord(entity, data, triggers) {
  return new Promise((resolve, reject) => {
    var cfg = { Entity: entity, APIData: data, Trigger: triggers||[] };
    console.log('[API] updateRecord', JSON.stringify(cfg,null,2));
    ZOHO.CRM.API.updateRecord(cfg).then(r => { console.log('[API] updateRecord result', r); resolve(r); }).catch(e => { console.error('[API] updateRecord error', e); reject(e); });
  });
}

// ─── Load data ────────────────────────────────────────────

async function loadEngineers() {
  console.log('[APP] Loading engineers...');
  showLoader('Loading engineers...');
  try {
    var data = await apiGetAllRecords(MODULES.ENGINEERS);
    allEngineers = data||[];
    dom.headerSub.textContent = allEngineers.length+' engineers loaded';
    dom.headerBadge.textContent = allEngineers.length+' engineers';
    // Extract skills
    var ss = new Set();
    allEngineers.forEach(function(e){
      var sk = e[FIELD.ENGINEERS.SKILLS];
      if (sk) sk.split(/[;,|]/).forEach(function(s){ var t=s.trim(); if(t) ss.add(t); });
    });
    skillOptions = Array.from(ss).sort();
    var sel = dom.filterSkill;
    sel.innerHTML = '<option value="">All Skills</option>';
    skillOptions.forEach(function(s){ var o=document.createElement('option'); o.value=s; o.textContent=s; sel.appendChild(o); });
    console.log('[APP] Engineers loaded:', allEngineers.length);
    log('✅ Engineers Loaded', allEngineers.length+' engineers', 'success');
  } catch(e) {
    console.error('[APP] loadEngineers error:', e);
    dom.headerSub.textContent = 'Error loading engineers';
    showToast('Error: '+e.message, 'error');
    log('❌ Engineers Load Error', e.message, 'error');
  } finally { hideLoader(); }
}

async function loadSchedules() {
  console.log('[APP] Loading schedules...');
  try {
    var data = await apiGetAllRecords(MODULES.SCHEDULES);
    allSchedules = data||[];
    console.log('[APP] Schedules loaded:', allSchedules.length);
    log('📅 Schedules Loaded', allSchedules.length+' schedules', 'info');
    // Populate schedule dropdown
    var sel = dom.scheduleSelect;
    sel.innerHTML = '<option value="">— Choose existing schedule —</option>';
    allSchedules.forEach(function(s){
      var o = document.createElement('option');
      o.value = s.id;
      o.textContent = (s[FIELD.SCHEDULES.NAME]||'Unnamed')+' ('+(s[FIELD.SCHEDULES.DATE]||'no date')+')';
      sel.appendChild(o);
    });
  } catch(e) {
    console.error('[APP] loadSchedules error:', e);
    allSchedules = [];
    log('⚠️ Schedules Load Error', e.message, 'warn');
  }
}

// ─── Load Links ─────────────────────────────────────────
async function loadLinks() {
  console.log('[APP] Loading linking records...');
  try {
    var data = await apiGetAllRecords(LINKING_MODULE);
    allLinks = data||[];
    console.log('[APP] Links loaded:', allLinks.length);
    log('🔗 Links Loaded', allLinks.length+' linking records', 'info');
  } catch(e) {
    console.error('[APP] loadLinks error:', e);
    allLinks = [];
    log('⚠️ Links Load Error', e.message, 'warn');
  }
}

// Get linked engineers for a specific schedule
function getLinkedEngineerIds(scheduleId) {
  var ids = [];
  allLinks.forEach(function(link) {
    var sched = link[LINK_FIELD_SCHEDULE];
    var eng = link[LINK_FIELD_ENGINEER];
    var schedId = typeof sched === 'object' ? String(sched.id) : String(sched);
    var engId = typeof eng === 'object' ? String(eng.id) : String(eng);
    if (schedId === String(scheduleId)) {
      ids.push({ engineerId: engId, linkId: link.id });
    }
  });
  return ids;
}

// Get linked schedule id for an engineer
function getLinkedScheduleIds(engineerId) {
  var ids = [];
  allLinks.forEach(function(link) {
    var sched = link[LINK_FIELD_SCHEDULE];
    var eng = link[LINK_FIELD_ENGINEER];
    var engId = typeof eng === 'object' ? String(eng.id) : String(eng);
    var schedId = typeof sched === 'object' ? String(sched.id) : String(sched);
    if (engId === String(engineerId)) {
      ids.push(schedId);
    }
  });
  return ids;
}

// ─── Unlink Engineers ────────────────────────────────────
async function unlinkEngineers() {
  if (selectedIds.size === 0) { showToast('No engineers selected', 'error'); return; }

  var schedId = dom.scheduleSelect.value;
  if (!schedId) { showToast('Select a schedule first', 'error'); return; }

  var engineerIds = Array.from(selectedIds);
  var linked = getLinkedEngineerIds(schedId);
  var linkIds = [];
  engineerIds.forEach(function(eid) {
    linked.forEach(function(l) {
      if (String(l.engineerId) === String(eid)) linkIds.push(l.linkId);
    });
  });

  if (linkIds.length === 0) { showToast('No matching links found to unlink', 'error'); return; }

  if (!confirm('Unlink ' + linkIds.length + ' engineer(s) from this schedule?')) return;

  showLoader('Unlinking...');
  log('🔗 Unlinking', {scheduleId: schedId, count: linkIds.length}, 'info');

  var unlinkCount = 0;
  for (var i = 0; i < linkIds.length; i++) {
    try {
      await apiDeleteRecord(LINKING_MODULE, linkIds[i]);
      unlinkCount++;
      log('🔓 Unlinked', 'Link ' + linkIds[i], 'success');
    } catch(e) {
      console.error('[APP] Unlink error:', e);
      log('❌ Unlink Error', linkIds[i] + ': ' + e.message, 'error');
    }
  }

  showToast(unlinkCount + ' link(s) removed', 'success');
  await loadLinks();
  await loadSchedules();
  selectedIds.clear();
  updateSelectionUI();
  await findAvailableEngineers();
  hideLoader();
}

// ─── Reschedule Engineers ────────────────────────────────
async function rescheduleEngineers() {
  if (selectedIds.size === 0) { showToast('No engineers selected', 'error'); return; }

  var currentSchedId = dom.scheduleSelect.value;
  if (!currentSchedId) { showToast('Select a schedule first', 'error'); return; }

  var newDate = prompt('Enter new date (YYYY-MM-DD):');
  if (!newDate) return;
  var newTime = prompt('Enter new end time (HH:MM):');
  if (!newTime) return;

  showLoader('Rescheduling...');
  log('🔄 Reschedule', {from: currentSchedId, date: newDate, endTime: newTime}, 'info');

  // Update the current schedule's date/time
  try {
    await apiUpdateRecord(MODULES.SCHEDULES, {
      id: currentSchedId,
      Date: newDate,
      End_time: newDate + 'T' + newTime + ':00'
    });
    log('✅ Schedule Updated', 'Date/Time updated', 'success');
  } catch(e) {
    console.error('[APP] Reschedule update error:', e);
    log('❌ Reschedule Error', e.message, 'error');
    hideLoader();
    return;
  }

  showToast('Schedule date/time updated', 'success');
  await loadSchedules();
  await loadLinks();
  dom.scheduleSelect.value = currentSchedId;
  selectedIds.clear();
  updateSelectionUI();
  await findAvailableEngineers();
  hideLoader();
}

// ─── Availability ─────────────────────────────────────────

function isEngineerAvailable(engId, dateStr, startTime, endTime) {
  var fS = new Date(dateStr+'T'+startTime+':00');
  var fE = new Date(dateStr+'T'+endTime+':00');
  if (isNaN(fS.getTime())||isNaN(fE.getTime())) return false;
  if (fE<=fS) return false;

  // Check linking records to see if engineer is assigned to any schedule
  // that overlaps with the requested time window
  for (var i = 0; i < allLinks.length; i++) {
    var link = allLinks[i];
    var sched = link[LINK_FIELD_SCHEDULE];
    var eng = link[LINK_FIELD_ENGINEER];
    var linkSchedId = typeof sched === 'object' ? String(sched.id) : String(sched);
    var linkEngId = typeof eng === 'object' ? String(eng.id) : String(eng);

    if (linkEngId !== String(engId)) continue;
    if (linkSchedId === activeScheduleId) continue; // skip current schedule

    // Find the schedule details
    var linkedSched = null;
    for (var j = 0; j < allSchedules.length; j++) {
      if (allSchedules[j].id === linkSchedId) {
        linkedSched = allSchedules[j];
        break;
      }
    }
    if (!linkedSched) continue;

    var sd = linkedSched[FIELD.SCHEDULES.DATE];
    var se = linkedSched[FIELD.SCHEDULES.END_TIME];
    if (sd !== dateStr || !se) continue;
    var sEnd = new Date(se);
    if (isNaN(sEnd.getTime())) continue;
    var overlap = fS < sEnd && fE > new Date(dateStr+'T00:00:00');
    if (overlap) {
      return false; // Engineer is assigned to another schedule on the same date/time
    }
  }
  return true;
}

// ─── Render ───────────────────────────────────────────────

function renderTable(engineers, showAvailability) {
  var tb = dom.tbody;
  if (!engineers||engineers.length===0) {
    tb.innerHTML = '<tr><td class="empty" colspan="6">No engineers found.</td></tr>';
    dom.headerBadge.textContent = '0 shown';
    return;
  }
  var html = '';
  var availCount = 0, unavailCount = 0;
  for (var i=0;i<engineers.length;i++) {
    var e = engineers[i];
    var id = e.id;
    var name = e[FIELD.ENGINEERS.NAME]||'Unnamed';
    var skills = e[FIELD.ENGINEERS.SKILLS]||'';
    var pos = e[FIELD.ENGINEERS.POSITION]||'-';
    var checked = selectedIds.has(id)?'checked':'';
    var isAvail = e._available;
    if (isAvail) availCount++; else unavailCount++;

    var skillTags = '';
    if (skills) {
      skillTags = skills.split(/[;,|]/).map(function(s){return s.trim();}).filter(Boolean).map(function(s){
        return '<span class="skill-tag">'+escapeHtml(s)+'</span> ';
      }).join('');
    }
    if (!skillTags) skillTags = '<span class="skill-tag empty-skill">—</span>';

    var availBadge = isAvail
      ? '<span style="color:var(--green);font-weight:600;font-size:12px;">✓ Available</span>'
      : '<span style="color:var(--red);font-weight:600;font-size:12px;">✗ Assigned</span>';

    var rowClass = checked?'selected':(isAvail?'':'unavailable');
    html += '<tr class="'+rowClass+'" data-id="'+id+'" data-available="'+(isAvail?1:0)+'">'+
      '<td><input type="checkbox" class="eng-check" data-id="'+id+'" '+checked+'></td>'+
      '<td><strong>'+escapeHtml(name)+'</strong></td>'+
      '<td>'+skillTags+'</td>'+
      '<td>'+escapeHtml(pos)+'</td>'+
      '<td>'+availBadge+'</td>'+
    '</tr>';
  }
  tb.innerHTML = html;

  if (showAvailability) {
    dom.headerBadge.textContent = availCount+' avail / '+unavailCount+' busy';
  } else {
    dom.headerBadge.textContent = availCount+' available';
  }
}

function updateManageButtons() {
  var hasSelected = selectedIds.size > 0;
  var showAllChecked = dom.showAll && dom.showAll.checked;

  // Show both assign and unlink/reschedule buttons when in showAll mode
  if (hasSelected && showAllChecked) {
    dom.btnAssign.style.display = 'inline-block';
    dom.btnUnlink.style.display = 'inline-block';
    dom.btnReschedule.style.display = 'inline-block';
    dom.btnAssign.disabled = false;
  } else if (hasSelected) {
    // Only assign when showing available
    dom.btnAssign.style.display = 'inline-block';
    dom.btnUnlink.style.display = 'inline-block';
    dom.btnReschedule.style.display = 'inline-block';
    dom.btnAssign.disabled = false;
  } else {
    dom.btnAssign.style.display = 'inline-block';
    dom.btnUnlink.style.display = 'none';
    dom.btnReschedule.style.display = 'none';
    dom.btnAssign.disabled = true;
  }
}

function updateSelectionUI() {
  var c = selectedIds.size;
  if (c===0) {
    dom.selectionBar.style.display='none';
    dom.scheduleSec.style.display='none';
    dom.btnAssign.disabled=true;
    dom.btnUnlink.style.display='none';
    dom.btnReschedule.style.display='none';
    return;
  }
  var selEngs = filteredEngineers.filter(function(e){ return selectedIds.has(e.id); });
  var names = selEngs.map(function(e){ return e[FIELD.ENGINEERS.NAME]||'Unnamed'; }).join(', ');
  dom.selectedCount.textContent = c+' engineer'+(c>1?'s':'')+' selected';
  dom.selectedNames.textContent = names;
  dom.selectionBar.style.display='flex';
  dom.scheduleSec.style.display='block';
  dom.btnAssign.disabled = false;
  updateManageButtons();
}

// ─── Find Available ───────────────────────────────────────

async function findAvailableEngineers() {
  var date = dom.filterDate.value;
  var startTime = dom.filterStart.value;
  var endTime = dom.filterEnd.value;
  var skillFilter = dom.filterSkill.value;
  var showAllChecked = dom.showAll && dom.showAll.checked;

  if (!showAllChecked) {
    if (!date||!startTime||!endTime) { showToast('Select Date, Start and End Time','error'); return; }
    if (new Date(date+'T'+endTime+':00')<=new Date(date+'T'+startTime+':00')) { showToast('End must be after Start','error'); return; }
  }

  log('🔍 Finding Engineers', {date: date, timeRange: startTime+'-'+endTime, skill: skillFilter||'any', showAll: showAllChecked}, 'info');
  showLoader('Loading...');

  try {
    // Get already-assigned engineers from linking records for current schedule
    var alreadyAssignedIds = [];
    var schedId = dom.scheduleSelect.value;
    if (schedId) {
      var linked = getLinkedEngineerIds(schedId);
      alreadyAssignedIds = linked.map(function(l) { return l.engineerId; });
      // Pre-fill filter date from schedule
      if (!showAllChecked) {
        for (var i=0;i<allSchedules.length;i++) {
          if (allSchedules[i].id===schedId) {
            if (allSchedules[i][FIELD.SCHEDULES.DATE]) dom.filterDate.value = allSchedules[i][FIELD.SCHEDULES.DATE];
            break;
          }
        }
      }
    }

    // Start with all engineers
    var candidates = allEngineers.slice();

    // Filter by skill
    if (skillFilter) {
      candidates = candidates.filter(function(e){
        var sk = e[FIELD.ENGINEERS.SKILLS]||'';
        return sk.split(/[;,|]/).map(function(s){return s.trim().toLowerCase();}).filter(Boolean).indexOf(skillFilter.toLowerCase())!==-1;
      });
    }

    if (showAllChecked) {
      // Show ALL engineers with availability status
      var enriched = candidates.map(function(e) {
        var avail = isEngineerAvailable(e.id, date||'', startTime||'', endTime||'');
        return Object.assign({}, e, { _available: avail });
      });

      // Sort: available first, then unavailable
      enriched.sort(function(a,b){ return (b._available?1:0)-(a._available?1:0); });

      filteredEngineers = enriched;
      selectedIds.clear();
      updateSelectionUI();
      renderTable(enriched, true);

      var availN = enriched.filter(function(e){return e._available;}).length;
      dom.headerSub.textContent = 'Showing all: '+availN+' available, '+(enriched.length-availN)+' assigned';
      log('📋 Show All', enriched.length+' engineers shown', 'info');

    } else {
      // Show only available engineers (not assigned to current schedule)
      var notAssigned = candidates.filter(function(e){ return alreadyAssignedIds.indexOf(String(e.id))===-1; });

      var available = [];
      for (var i=0;i<notAssigned.length;i++) {
        if (isEngineerAvailable(notAssigned[i].id, date, startTime, endTime)) {
          notAssigned[i]._available = true;
          available.push(notAssigned[i]);
        }
      }

      filteredEngineers = available;
      selectedIds.clear();
      updateSelectionUI();
      renderTable(available);
      dom.headerSub.textContent = date+': '+(alreadyAssignedIds.length>0?'('+alreadyAssignedIds.length+' already assigned) ':'')+available.length+' available';
      log('✅ Available', available.length+' engineers available', available.length>0?'success':'warn');
    }

  } catch(e) {
    console.error('[APP] findAvailable error:', e);
    log('❌ Error', e.message, 'error');
    showToast('Error: '+e.message, 'error');
  } finally { hideLoader(); }
}

// ─── Assign ───────────────────────────────────────────────

async function assignSchedule() {
  var schedSelectVal = dom.scheduleSelect.value;
  var newName = dom.newSchedName.value.trim();

  // Determine which schedule we're working with
  var targetScheduleId = null;
  var isNewSchedule = false;

  if (newName) {
    isNewSchedule = true; // User wants to create a new schedule
  } else if (schedSelectVal) {
    targetScheduleId = schedSelectVal; // Use existing schedule
  }

  if (!isNewSchedule && !targetScheduleId) {
    showToast('Please select an existing schedule or enter a new schedule name', 'error');
    return;
  }

  if (selectedIds.size===0) { showToast('No engineers selected','error'); return; }

  var engineerIds = Array.from(selectedIds);
  console.log('[APP] Assigning', engineerIds.length, 'engineers. Target schedule:', isNewSchedule?'NEW':'EXISTING '+targetScheduleId);
  log('📝 Assigning', {engineers:engineerIds.length, new:isNewSchedule, existing:targetScheduleId}, 'info');

  showLoader('Saving...');

  try {
    if (isNewSchedule) {
      // STEP 1: Create new schedule
      var date = dom.filterDate.value;
      var endTime = dom.filterEnd.value;
      if (!date||!endTime) { showToast('Date and End Time required for new schedule','error'); hideLoader(); return; }

      var schedData = {
        Name: newName,
        Date: date,
        End_time: date+'T'+endTime+':00'
      };

      console.log('[APP] Creating new schedule:', JSON.stringify(schedData));
      log('📤 Creating Schedule', schedData, 'info');
      var result = await apiInsertRecord(MODULES.SCHEDULES, schedData, []);

      var success = false;
      if (result&&result.data) {
        var recs = Array.isArray(result.data)?result.data:result.data.data;
        if (recs&&recs.length>0&&recs[0].code==='SUCCESS') {
          success = true;
          targetScheduleId = recs[0].details.id;
          console.log('[APP] New schedule created ID:', targetScheduleId);
          log('✅ Schedule Created', 'ID: '+targetScheduleId, 'success');
        }
      }
      if (!success) {
        console.error('[APP] Create failed:', result);
        log('❌ Create Failed', result, 'error');
        showToast('Failed to create schedule','error');
        hideLoader(); return;
      }
    } else {
      // Update the Date and End_time on the existing schedule if filter has values
      var date = dom.filterDate.value;
      var endTime = dom.filterEnd.value;
      if (date && endTime) {
        var updData = {
          id: targetScheduleId,
          Date: date,
          End_time: date+'T'+endTime+':00'
        };
        console.log('[APP] Updating existing schedule:', JSON.stringify(updData));
        log('📤 Updating Schedule', updData, 'info');
        await apiUpdateRecord(MODULES.SCHEDULES, updData, []);
      }
    }

    // STEP 2: Link engineers via the linking module Schedules_X_Engineers2
    activeScheduleId = targetScheduleId;
    console.log('[APP] Linking via', LINKING_MODULE, '- Schedule:', targetScheduleId, '- Engineers:', engineerIds.length);
    log('🔗 Linking via Module', {module: LINKING_MODULE, scheduleId: targetScheduleId, engineerCount: engineerIds.length}, 'info');

    var linkedCount = 0, failedCount = 0;
    for (var i = 0; i < engineerIds.length; i++) {
      var eid = engineerIds[i];
      try {
        var linkData = {};
        linkData[LINK_FIELD_SCHEDULE] = { id: targetScheduleId };
        linkData[LINK_FIELD_ENGINEER] = { id: eid };
        console.log('[APP] insertRecord into', LINKING_MODULE, ':', JSON.stringify(linkData));

        var linkResult = await apiInsertRecord(LINKING_MODULE, linkData, []);

        if (linkResult && linkResult.data) {
          var linkRecs = Array.isArray(linkResult.data) ? linkResult.data : (linkResult.data.data || [linkResult.data]);
          if (linkRecs && linkRecs.length > 0 && linkRecs[0].code === 'SUCCESS') {
            linkedCount++;
            log('🔗 Linked', 'Schedule ' + targetScheduleId + ' ← Engineer ' + eid, 'success');
          } else {
            failedCount++;
            log('❌ Link Failed', eid + ': ' + JSON.stringify(linkResult), 'error');
          }
        } else {
          failedCount++;
          log('❌ Link Failed', eid + ': no response data', 'error');
        }
      } catch(le) {
        console.error('[APP] Link error for', eid, le);
        failedCount++;
        log('❌ Link Error', eid + ': ' + (le.message||JSON.stringify(le)), 'error');
      }
    }

    if (linkedCount > 0) {
      showToast(linkedCount + ' engineer(s) linked to schedule!', 'success');
      log('✅ Engineers Linked', linkedCount + ' links created on schedule', 'success');
    } else if (failedCount > 0) {
      console.error('[APP] All linking failed');
      log('❌ All Links Failed', failedCount + ' link(s) failed', 'error');
      showToast('Failed to link any engineers to schedule', 'error');
    }

    // Refresh
    await loadSchedules();

    // Select the schedule in dropdown
    dom.scheduleSelect.value = targetScheduleId;

    // Clear selections
    dom.newSchedName.value = '';
    selectedIds.clear();
    updateSelectionUI();

    // Re-render
    await findAvailableEngineers();

  } catch(e) {
    console.error('[APP] assign error:', e);
    log('❌ Assignment Error', e.message||e, 'error');
    showToast('Error: '+(e.message||'Unknown'), 'error');
  } finally { hideLoader(); }
}

// ─── Events ───────────────────────────────────────────────

function bindEvents() {
  dom.btnFilter.addEventListener('click', findAvailableEngineers);

  // Schedule select → show already assigned engineers count
  dom.scheduleSelect.addEventListener('change', function() {
    var schedId = this.value;
    activeScheduleId = schedId||null;
    if (schedId) {
      // Find schedule and show date in filter
      for (var i=0;i<allSchedules.length;i++) {
        if (allSchedules[i].id===schedId) {
          var s = allSchedules[i];
          if (s[FIELD.SCHEDULES.DATE]) dom.filterDate.value = s[FIELD.SCHEDULES.DATE];
          break;
        }
      }
    }
  });

  // Checkbox delegation
  dom.tbody.addEventListener('change', function(e){
    if (e.target.classList.contains('eng-check')) {
      var id = e.target.dataset.id;
      if (e.target.checked) { selectedIds.add(id); var r=e.target.closest('tr'); if(r)r.classList.add('selected'); }
      else { selectedIds.delete(id); var r=e.target.closest('tr'); if(r)r.classList.remove('selected'); }
      updateSelectionUI();
    }
  });

  // Select All
  dom.selectAll.addEventListener('change', function(){
    var cbs = dom.tbody.querySelectorAll('.eng-check');
    var rs = dom.tbody.querySelectorAll('tr');
    if (this.checked) { cbs.forEach(function(cb){cb.checked=true;selectedIds.add(cb.dataset.id);}); rs.forEach(function(r){r.classList.add('selected');}); }
    else { cbs.forEach(function(cb){cb.checked=false;selectedIds.delete(cb.dataset.id);}); rs.forEach(function(r){r.classList.remove('selected');}); }
    updateSelectionUI();
  });

  dom.btnAssign.addEventListener('click', assignSchedule);
  dom.btnUnlink.addEventListener('click', unlinkEngineers);
  dom.btnReschedule.addEventListener('click', rescheduleEngineers);

  // Show All checkbox
  if (dom.showAll) {
    dom.showAll.addEventListener('change', function() {
      findAvailableEngineers();
    });
  }

  // Discover API Names button
  var btnDiscover = $('btnDiscover');
  if (btnDiscover) {
    btnDiscover.addEventListener('click', async function() {
      showLoader('Fetching module metadata...');
      log('🔍 Discovering API Names', 'Fetching all module definitions...', 'info');
      try {
        // Get all modules
        var modules = await new Promise(function(resolve, reject) {
          ZOHO.CRM.META.getModules().then(function(r) {
            console.log('[META] getModules raw:', JSON.stringify(r));
            resolve(r);
          }).catch(function(e) { reject(e); });
        });

        log('📦 All Modules', modules, 'info');

        // Also try getting specific field metadata for Engineers and Schedules
        var engFields = await new Promise(function(resolve, reject) {
          ZOHO.CRM.META.getFields({Entity: 'Engineers'}).then(function(r) {
            resolve(r);
          }).catch(function(e) { reject(e); });
        });
        log('🔧 Engineers Fields', engFields, 'info');

        var schedFields = await new Promise(function(resolve, reject) {
          ZOHO.CRM.META.getFields({Entity: 'Schedules'}).then(function(r) {
            resolve(r);
          }).catch(function(e) { reject(e); });
        });
        log('🔧 Schedules Fields', schedFields, 'info');

        // Try to find linking/related modules
        if (modules && Array.isArray(modules)) {
          modules.forEach(function(m) {
            var name = (m.api_name || m.module_name || '').toLowerCase();
            if (name.indexOf('engineer') !== -1 || name.indexOf('schedule') !== -1 || name.indexOf('link') !== -1 || name.indexOf('junction') !== -1) {
              log('🔗 Related Module', { api_name: m.api_name, plural_label: m.plural_label, singular_label: m.singular_label }, 'success');
            }
          });
        }

        // Also try ZOHO.CRM.API.getAllRecords on common linking module names
        var possibleLinkNames = ['Schedules_Engineers', 'Engineers_Schedules', 'Schedule_Engineer', 'Engineer_Schedule', 'Schedules_Engineers_L', 'Engineers_Schedules_L'];
        for (var pi = 0; pi < possibleLinkNames.length; pi++) {
          try {
            var linkData = await new Promise(function(resolve, reject) {
              ZOHO.CRM.API.getAllRecords({Entity: possibleLinkNames[pi], page: 1, per_page: 5}).then(function(r) {
                resolve(r);
              }).catch(function(e) { reject(e); });
            });
            if (linkData) {
              log('✅ Found Linking Module', possibleLinkNames[pi] + ': ' + JSON.stringify(linkData), 'success');
            }
          } catch(e) {
            // Module not found, skip
          }
        }

        log('✅ Discovery Complete', 'Open the debug console to review all module names and fields', 'success');
        showToast('API names logged to debug console', 'success');

      } catch(e) {
        console.error('[META] Discovery error:', e);
        log('❌ Discovery Error', e.message || JSON.stringify(e), 'error');
        showToast('Error: ' + (e.message || 'Check console'), 'error');
      } finally {
        hideLoader();
      }
    });
  }
}

// ─── Auto-Refresh ─────────────────────────────────────────

let autoRefreshInterval = null;

function startAutoRefresh() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  autoRefreshInterval = setInterval(async function() {
    try {
      await loadLinks();
      // Re-render if "Show All" is checked
      if (dom.showAll && dom.showAll.checked) {
        await findAvailableEngineers();
        log('🔄 Auto-refreshed table', '', 'info');
      }
    } catch(e) {
      console.log('[APP] Auto-refresh skipped:', e.message);
    }
  }, 30000); // every 30 seconds
}

// ─── Init ─────────────────────────────────────────────────

ZOHO.embeddedApp.on("PageLoad", async function(data) {
  console.log('[APP] PageLoad', data);
  log('🚀 Widget Started', {timestamp:new Date().toISOString()}, 'info');
  try {
    var today = new Date().toISOString().split('T')[0];
    dom.filterDate.value = today;
    await Promise.all([loadEngineers(), loadSchedules(), loadLinks()]);
    bindEvents();
    startAutoRefresh();
    console.log('[APP] Init complete. Engineers:', allEngineers.length, 'Schedules:', allSchedules.length, 'Links:', allLinks.length);
    log('✅ Ready', {engineers:allEngineers.length, schedules:allSchedules.length, links:allLinks.length}, 'success');
    showToast('Ready! Table auto-refreshes every 30s.', 'info');
  } catch(e) {
    console.error('[APP] Init error:', e);
    log('❌ Init Error', e.message, 'error');
    showToast('Init failed: '+e.message, 'error');
  }
});

ZOHO.embeddedApp.init();