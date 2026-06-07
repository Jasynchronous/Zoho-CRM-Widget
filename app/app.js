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

// ─── Availability ─────────────────────────────────────────

function isEngineerAvailable(engId, dateStr, startTime, endTime) {
  var fS = new Date(dateStr+'T'+startTime+':00');
  var fE = new Date(dateStr+'T'+endTime+':00');
  if (isNaN(fS.getTime())||isNaN(fE.getTime())) return false;
  if (fE<=fS) return false;

  for (var i=0;i<allSchedules.length;i++) {
    var s = allSchedules[i];
    // Skip the currently selected schedule (we're editing it)
    if (s.id === activeScheduleId) continue;
    var sd = s[FIELD.SCHEDULES.DATE];
    var se = s[FIELD.SCHEDULES.END_TIME];
    if (sd !== dateStr || !se) continue;
    var sEnd = new Date(se);
    if (isNaN(sEnd.getTime())) continue;
    var overlap = fS < sEnd && fE > new Date(dateStr+'T00:00:00');
    if (overlap) {
      var engs = s[FIELD.SCHEDULES.ENGINEERS];
      if (engs) {
        var ids = [];
        if (Array.isArray(engs)) ids = engs.map(function(e){ return typeof e==='object' ? String(e.id) : String(e); });
        else if (typeof engs==='string') ids = [engs];
        if (ids.indexOf(String(engId))!==-1) return false;
      }
    }
  }
  return true;
}

// ─── Render ───────────────────────────────────────────────

function renderTable(engineers) {
  var tb = dom.tbody;
  if (!engineers||engineers.length===0) {
    tb.innerHTML = '<tr><td class="empty" colspan="5">No available engineers found.</td></tr>';
    dom.headerBadge.textContent = '0 available';
    return;
  }
  var html = '';
  for (var i=0;i<engineers.length;i++) {
    var e = engineers[i];
    var id = e.id;
    var name = e[FIELD.ENGINEERS.NAME]||'Unnamed';
    var skills = e[FIELD.ENGINEERS.SKILLS]||'';
    var pos = e[FIELD.ENGINEERS.POSITION]||'-';
    var status = e[FIELD.ENGINEERS.STATUS]||'-';
    var checked = selectedIds.has(id)?'checked':'';
    var skillTags = '';
    if (skills) {
      skillTags = skills.split(/[;,|]/).map(function(s){return s.trim();}).filter(Boolean).map(function(s){
        return '<span class="skill-tag">'+escapeHtml(s)+'</span> ';
      }).join('');
    }
    if (!skillTags) skillTags = '<span class="skill-tag empty-skill">—</span>';
    html += '<tr class="'+(checked?'selected':'')+'" data-id="'+id+'">'+
      '<td><input type="checkbox" class="eng-check" data-id="'+id+'" '+checked+'></td>'+
      '<td><strong>'+escapeHtml(name)+'</strong></td>'+
      '<td>'+skillTags+'</td>'+
      '<td>'+escapeHtml(pos)+'</td>'+
      '<td>'+escapeHtml(status)+'</td>'+
    '</tr>';
  }
  tb.innerHTML = html;
  dom.headerBadge.textContent = engineers.length+' available';
}

function updateSelectionUI() {
  var c = selectedIds.size;
  if (c===0) {
    dom.selectionBar.style.display='none';
    dom.scheduleSec.style.display='none';
    dom.btnAssign.disabled=true;
    return;
  }
  var selEngs = filteredEngineers.filter(function(e){ return selectedIds.has(e.id); });
  var names = selEngs.map(function(e){ return e[FIELD.ENGINEERS.NAME]||'Unnamed'; }).join(', ');
  dom.selectedCount.textContent = c+' engineer'+(c>1?'s':'')+' selected';
  dom.selectedNames.textContent = names;
  dom.selectionBar.style.display='flex';
  dom.scheduleSec.style.display='block';
  dom.btnAssign.disabled = false;
}

// ─── Find Available ───────────────────────────────────────

async function findAvailableEngineers() {
  var date = dom.filterDate.value;
  var startTime = dom.filterStart.value;
  var endTime = dom.filterEnd.value;
  var skillFilter = dom.filterSkill.value;

  console.log('[APP] Finding available:', {date,start:startTime,end:endTime,skill:skillFilter});
  log('🔍 Finding Available', {date, timeRange:startTime+'-'+endTime, skill:skillFilter||'any'}, 'info');

  if (!date||!startTime||!endTime) { showToast('Select Date, Start and End Time','error'); return; }
  if (new Date(date+'T'+endTime+':00')<=new Date(date+'T'+startTime+':00')) { showToast('End must be after Start','error'); return; }

  showLoader('Checking availability...');
  try {
    // Get already-assigned engineers in the selected schedule
    var alreadyAssignedIds = [];
    var schedId = dom.scheduleSelect.value;
    var selectedSched = null;
    if (schedId) {
      for (var i=0;i<allSchedules.length;i++) {
        if (allSchedules[i].id===schedId) { selectedSched=allSchedules[i]; break; }
      }
      if (selectedSched) {
        var engs = selectedSched[FIELD.SCHEDULES.ENGINEERS];
        if (engs) {
          if (Array.isArray(engs)) alreadyAssignedIds = engs.map(function(e){ return typeof e==='object'?String(e.id):String(e); });
          else if (typeof engs==='string') alreadyAssignedIds = [engs];
        }
        // Pre-fill filter date from schedule
        if (selectedSched[FIELD.SCHEDULES.DATE]) dom.filterDate.value = selectedSched[FIELD.SCHEDULES.DATE];
      }
    }

    // Candidates: not already assigned to this schedule
    var candidates = allEngineers.filter(function(e){ return alreadyAssignedIds.indexOf(String(e.id))===-1; });

    if (skillFilter) {
      candidates = candidates.filter(function(e){
        var sk = e[FIELD.ENGINEERS.SKILLS]||'';
        return sk.split(/[;,|]/).map(function(s){return s.trim().toLowerCase();}).filter(Boolean).indexOf(skillFilter.toLowerCase())!==-1;
      });
    }

    var available = [];
    for (var i=0;i<candidates.length;i++) {
      if (isEngineerAvailable(candidates[i].id, date, startTime, endTime)) {
        available.push(candidates[i]);
      }
    }

    filteredEngineers = available;
    dom.headerSub.textContent = date+': '+(alreadyAssignedIds.length>0?'('+alreadyAssignedIds.length+' already assigned) ':'')+available.length+' available';
    selectedIds.clear();
    updateSelectionUI();
    renderTable(available);
    log('✅ Available', available.length+' engineers available', available.length>0?'success':'warn');

  } catch(e) {
    console.error('[APP] findAvailable error:', e);
    log('❌ Availability Error', e.message, 'error');
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

// ─── Init ─────────────────────────────────────────────────

ZOHO.embeddedApp.on("PageLoad", async function(data) {
  console.log('[APP] PageLoad', data);
  log('🚀 Widget Started', {timestamp:new Date().toISOString()}, 'info');
  try {
    var today = new Date().toISOString().split('T')[0];
    dom.filterDate.value = today;
    await Promise.all([loadEngineers(), loadSchedules()]);
    bindEvents();
    console.log('[APP] Init complete. Engineers:', allEngineers.length, 'Schedules:', allSchedules.length);
    log('✅ Ready', {engineers:allEngineers.length, schedules:allSchedules.length}, 'success');
    showToast('Ready! Select schedule and find available engineers.', 'info');
  } catch(e) {
    console.error('[APP] Init error:', e);
    log('❌ Init Error', e.message, 'error');
    showToast('Init failed: '+e.message, 'error');
  }
});

ZOHO.embeddedApp.init();