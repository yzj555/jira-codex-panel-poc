window.__ModuleLoader__.load({ id: "@jira-workbench/dsh-client", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/JiraConfigCard.tsx
var import_react = require("react");

// ../../node_modules/clsx/dist/clsx.mjs
function r(e) {
  var t, f, n = "";
  if ("string" == typeof e || "number" == typeof e) n += e;
  else if ("object" == typeof e) if (Array.isArray(e)) {
    var o = e.length;
    for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
  } else for (f in e) e[f] && (n && (n += " "), n += f);
  return n;
}
function clsx() {
  for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
  return n;
}
var clsx_default = clsx;

// src/client/JiraConfigCard.tsx
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/JiraConfigCard.module.css
var css = '.Dlj8CW_card{--jira-accent:#4c72d9;--jira-accent-soft:color-mix(in srgb, var(--jira-accent) 10%, transparent);--jira-bug:#c45b50;--jira-ok:#3b9164;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s;overflow:hidden}.Dlj8CW_card,.Dlj8CW_card *,.Dlj8CW_card :before,.Dlj8CW_card :after{box-sizing:border-box}.Dlj8CW_card:hover,.Dlj8CW_cardOpen{border-color:color-mix(in srgb, var(--jira-accent) 30%, var(--dsw-alias-border-l2))}.Dlj8CW_cardOpen{overflow:visible}.Dlj8CW_pluginCard{width:100%}.Dlj8CW_pluginCard .Dlj8CW_header{padding:14px 15px}.Dlj8CW_pluginCard .Dlj8CW_description{white-space:normal;-webkit-line-clamp:2;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}.Dlj8CW_pluginCard .Dlj8CW_section{padding:18px 16px 16px}.Dlj8CW_pluginCard .Dlj8CW_connectionGrid{grid-template-columns:1fr;gap:16px}.Dlj8CW_pluginCard .Dlj8CW_footer{grid-template-columns:minmax(0,1fr) auto auto;padding:12px 16px 14px;display:grid}.Dlj8CW_workspaceCard{background:linear-gradient(180deg, color-mix(in srgb, var(--jira-accent) 2.5%, var(--dsw-alias-bg-base)) 0, var(--dsw-alias-bg-base) 170px), var(--dsw-alias-bg-base);border:0;border-radius:0;flex-direction:column;width:100%;height:100%;min-height:0;display:flex;overflow:hidden}.Dlj8CW_workspaceCard:hover,.Dlj8CW_workspaceCard.Dlj8CW_cardOpen{border-color:#0000}.Dlj8CW_workspaceCard .Dlj8CW_body{border-top:0;flex:1;grid-template-rows:minmax(0,1fr) auto;grid-template-columns:188px minmax(0,1fr);min-height:0;display:grid;overflow:hidden}.Dlj8CW_workspaceCard .Dlj8CW_settingsNav{grid-area:1/1}.Dlj8CW_workspaceCard .Dlj8CW_settingsContent{scroll-behavior:smooth;scrollbar-gutter:stable;grid-area:1/2;min-width:0;min-height:0;overflow:auto;container:Dlj8CW_jira-settings-content/inline-size}.Dlj8CW_workspaceCard .Dlj8CW_section,.Dlj8CW_workspaceCard .Dlj8CW_loading{width:min(100%,1040px);margin:0 auto;padding:34px 32px 46px}.Dlj8CW_workspaceCard .Dlj8CW_section{scroll-margin-top:0}.Dlj8CW_workspaceCard .Dlj8CW_section+.Dlj8CW_section{border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 78%, transparent)}.Dlj8CW_workspaceCard .Dlj8CW_footer{background:var(--dsw-alias-bg-layer-3);grid-area:2/1/auto/-1;padding-left:max(26px,50% - 494px);padding-right:max(26px,50% - 494px)}.Dlj8CW_header{appearance:none;width:100%;color:inherit;cursor:pointer;font:inherit;text-align:left;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:15px 17px;display:flex}.Dlj8CW_header:focus,.Dlj8CW_settingsNavItem:focus,.Dlj8CW_choiceTrigger:focus,.Dlj8CW_choiceRow:focus,.Dlj8CW_segment:focus,.Dlj8CW_templateMode button:focus,.Dlj8CW_refresh:focus,.Dlj8CW_discard:focus,.Dlj8CW_save:focus{outline:0}.Dlj8CW_choiceRow:focus-visible,.Dlj8CW_refresh:focus-visible,.Dlj8CW_discard:focus-visible,.Dlj8CW_save:focus-visible{box-shadow:inset 0 0 0 2px color-mix(in srgb, var(--jira-accent) 54%, transparent);outline:0}.Dlj8CW_header:focus-visible{box-shadow:none}.Dlj8CW_settingsNavItem:focus-visible,.Dlj8CW_choiceTrigger:focus-visible,.Dlj8CW_segment:focus-visible,.Dlj8CW_templateMode button:focus-visible{background:var(--jira-accent-soft);box-shadow:none}.Dlj8CW_brandMark{background:var(--jira-accent-soft);width:34px;height:34px;color:var(--jira-accent);letter-spacing:.04em;border-radius:9px;flex:none;place-items:center;font-size:11px;font-weight:750;display:grid}.Dlj8CW_headText{flex-direction:column;flex:1;gap:3px;min-width:0;display:flex}.Dlj8CW_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:650;line-height:1.35}.Dlj8CW_description{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.45;overflow:hidden}.Dlj8CW_pending,.Dlj8CW_status,.Dlj8CW_templateState{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);white-space:nowrap;border-radius:999px;flex:none;padding:2px 7px;font-size:10px;font-weight:600;line-height:17px}.Dlj8CW_statusOk{background:color-mix(in srgb, var(--jira-ok) 11%, transparent);color:var(--jira-ok)}.Dlj8CW_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.Dlj8CW_chevronOpen{transform:rotate(180deg)}.Dlj8CW_body{border-top:1px solid var(--dsw-alias-border-l2)}.Dlj8CW_settingsNav{border-right:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 34%, var(--dsw-alias-bg-base));flex-direction:column;gap:1px;min-width:0;padding:28px 16px;display:flex}.Dlj8CW_settingsNavItem{appearance:none;min-height:54px;color:var(--dsw-alias-label-tertiary);cursor:pointer;box-shadow:none;font:inherit;text-align:left;background:0 0;border:0;border-radius:6px;padding:9px 10px 9px 17px;transition:background .14s,color .14s;position:relative}.Dlj8CW_settingsNavItem:before{content:"";background:0 0;border-radius:2px;width:2px;transition:background .14s,transform .14s;position:absolute;top:11px;bottom:11px;left:0}.Dlj8CW_settingsNavItem strong,.Dlj8CW_settingsNavItem small{display:block}.Dlj8CW_settingsNavItem strong{font-size:12px;font-weight:650;line-height:1.5}.Dlj8CW_settingsNavItem small{color:var(--dsw-alias-label-tertiary);margin-top:1px;font-size:10px;line-height:1.45}.Dlj8CW_settingsNavItem:hover{background:color-mix(in srgb, var(--jira-accent) 5%, transparent);color:var(--dsw-alias-label-primary)}.Dlj8CW_settingsNavItem:hover:before{background:color-mix(in srgb, var(--jira-accent) 30%, transparent)}.Dlj8CW_settingsNavItemActive{background:color-mix(in srgb, var(--jira-accent) 7%, transparent);color:var(--jira-accent);box-shadow:none}.Dlj8CW_settingsNavItemActive:before{background:var(--jira-accent);transform:scaleY(1.08)}.Dlj8CW_settingsNavItemActive small{color:color-mix(in srgb, var(--jira-accent) 72%, var(--dsw-alias-label-tertiary))}.Dlj8CW_loading{color:var(--dsw-alias-label-tertiary);text-align:center;padding:38px 20px}.Dlj8CW_section{padding:20px 18px 22px}.Dlj8CW_sectionHeading{border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 82%, transparent);max-width:none;margin-bottom:20px;padding:0 0 14px}.Dlj8CW_pluginConnectionHead{justify-content:space-between;align-items:flex-start;gap:16px;max-width:720px;margin-bottom:18px;display:flex}.Dlj8CW_pluginConnectionHead h3{color:var(--dsw-alias-label-primary);margin:0 0 3px;font-size:15px;font-weight:650;line-height:1.4}.Dlj8CW_pluginConnectionHead p{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.55}.Dlj8CW_pluginSettingsNote{border-left:2px solid color-mix(in srgb, var(--jira-accent) 52%, transparent);color:var(--dsw-alias-label-tertiary);margin:17px 0 0;padding-left:10px;font-size:11px;line-height:1.55}.Dlj8CW_sectionHeading h3{color:var(--dsw-alias-label-primary);margin:0 0 3px;font-size:16px;font-weight:650}.Dlj8CW_sectionHeading p,.Dlj8CW_modeHint,.Dlj8CW_skillRule,.Dlj8CW_optionMessage,.Dlj8CW_saveHint,.Dlj8CW_readOnly{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.55}.Dlj8CW_readOnly,.Dlj8CW_optionMessage{margin-bottom:12px}.Dlj8CW_connectionGrid,.Dlj8CW_sourceGrid,.Dlj8CW_templateGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;display:grid}.Dlj8CW_sourceGrid,.Dlj8CW_templateGrid{border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 84%, transparent);border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 84%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 26%, transparent);gap:0}.Dlj8CW_field,.Dlj8CW_pickerField{flex-direction:column;gap:6px;min-width:0;display:flex}.Dlj8CW_labelRow,.Dlj8CW_sourceToolbar,.Dlj8CW_panelTitle{align-items:center;gap:8px;display:flex}.Dlj8CW_labelRow{justify-content:space-between}.Dlj8CW_label{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:1.5}.Dlj8CW_input,.Dlj8CW_textarea,.Dlj8CW_templateTextarea,.Dlj8CW_searchInput{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);width:100%;color:var(--dsw-alias-label-primary);font:inherit;border-radius:9px;outline:0;font-size:12px;transition:border-color .14s,box-shadow .14s,background .14s}.Dlj8CW_input,.Dlj8CW_searchInput{height:36px;padding:0 11px}.Dlj8CW_textarea,.Dlj8CW_templateTextarea{resize:vertical;padding:9px 11px;line-height:1.55}.Dlj8CW_input:focus,.Dlj8CW_textarea:focus,.Dlj8CW_templateTextarea:focus,.Dlj8CW_searchInput:focus{border-color:var(--jira-accent);box-shadow:0 0 0 3px var(--jira-accent-soft)}.Dlj8CW_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.Dlj8CW_inputInvalid{border-color:var(--dsw-alias-label-error);}.Dlj8CW_invalid,.Dlj8CW_failed{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}.Dlj8CW_hint{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin:0;font-size:11px;line-height:1.5}.Dlj8CW_sourceToolbar{justify-content:flex-start;align-items:flex-end;gap:10px;margin-bottom:18px}.Dlj8CW_sourceToolbar .Dlj8CW_pickerField{width:min(560px,100% - 130px)}.Dlj8CW_refresh,.Dlj8CW_discard,.Dlj8CW_save{appearance:none;cursor:pointer;background:var(--dsw-alias-bg-layer-2);min-height:34px;color:var(--dsw-alias-label-secondary);font:inherit;border:0;border-radius:8px;padding:5px 13px;font-size:12px;font-weight:600;transition:background .14s,color .14s,box-shadow .14s,transform .14s}.Dlj8CW_refresh{background:color-mix(in srgb, var(--jira-accent) 9%, var(--dsw-alias-bg-layer-3));min-height:40px;color:var(--jira-accent);box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--jira-accent) 16%, transparent);align-items:center;gap:7px;padding:6px 14px 6px 11px;display:inline-flex}.Dlj8CW_refresh:hover:not(:disabled),.Dlj8CW_discard:hover:not(:disabled){background:color-mix(in srgb, var(--jira-accent) 14%, var(--dsw-alias-bg-layer-3));color:var(--jira-accent)}.Dlj8CW_refresh:hover:not(:disabled){box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--jira-accent) 26%, transparent);transform:translateY(-1px)}.Dlj8CW_refreshIcon{background:color-mix(in srgb, var(--jira-accent) 11%, transparent);border-radius:6px;place-items:center;width:20px;height:20px;font-size:15px;font-weight:500;line-height:1;display:grid}.Dlj8CW_refreshIconBusy{animation:.9s linear infinite Dlj8CW_refreshSpin}@keyframes Dlj8CW_refreshSpin{to{transform:rotate(360deg)}}.Dlj8CW_sourcePanel,.Dlj8CW_templatePanel{--panel-accent:var(--jira-accent);min-width:0;box-shadow:none;background:0 0;border-radius:0;padding:16px 22px 18px;overflow:visible}.Dlj8CW_bug{--panel-accent:var(--jira-bug)}.Dlj8CW_sourcePanel+.Dlj8CW_sourcePanel,.Dlj8CW_templatePanel+.Dlj8CW_templatePanel{border-left:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 82%, transparent)}.Dlj8CW_panelTitle{min-height:26px;margin-bottom:8px}.Dlj8CW_panelTitle strong{color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:650}.Dlj8CW_kindDot{background:var(--jira-accent);border-radius:50%;flex:none;width:7px;height:7px}.Dlj8CW_bug .Dlj8CW_kindDot{background:var(--jira-bug)}.Dlj8CW_segmented,.Dlj8CW_templateMode{border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 82%, transparent);box-shadow:none;background:0 0;border-radius:0;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;margin-bottom:12px;padding:0;display:grid}.Dlj8CW_segment,.Dlj8CW_templateMode button{appearance:none;min-height:34px;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;background:0 0;border:0;border-radius:0;padding:4px 7px;font-size:11px;font-weight:600;transition:background .14s,color .14s,box-shadow .14s,transform .14s;position:relative}.Dlj8CW_segment:hover,.Dlj8CW_templateMode button:hover{background:color-mix(in srgb, var(--panel-accent) 4%, transparent);color:var(--dsw-alias-label-primary)}.Dlj8CW_segmentActive,.Dlj8CW_templateModeActive{box-shadow:inset 0 -2px 0 color-mix(in srgb, var(--panel-accent) 78%, transparent);background:color-mix(in srgb, var(--panel-accent) 5%, transparent)!important;color:var(--panel-accent)!important}.Dlj8CW_modeHint{min-height:54px;padding:10px 2px 0}.Dlj8CW_filterPicker{border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 84%, transparent);background:var(--dsw-alias-bg-layer-3);border-radius:8px;gap:0;display:grid;overflow:hidden}.Dlj8CW_filterPicker .Dlj8CW_searchInput{border:0;border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 78%, transparent);background:0 0;border-radius:0}.Dlj8CW_filterList,.Dlj8CW_choiceList{gap:3px;max-height:205px;padding:3px;display:grid;overflow:auto}.Dlj8CW_filterList{background:0 0;border:0;border-radius:0}.Dlj8CW_filterRow{cursor:pointer;border-radius:7px;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:8px;min-width:0;padding:7px 8px;display:grid}.Dlj8CW_filterRow:hover,.Dlj8CW_filterSelected{background:var(--jira-accent-soft)}.Dlj8CW_filterRow input{accent-color:var(--jira-accent);margin-top:3px}.Dlj8CW_filterRow strong,.Dlj8CW_filterRow small,.Dlj8CW_choiceRow strong,.Dlj8CW_choiceRow small{text-overflow:ellipsis;white-space:nowrap;min-width:0;display:block;overflow:hidden}.Dlj8CW_filterRow strong,.Dlj8CW_choiceRow strong{color:var(--dsw-alias-label-primary);font-size:11px;font-weight:600}.Dlj8CW_filterRow small,.Dlj8CW_choiceRow small{color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:10px}.Dlj8CW_templateGrid{align-items:stretch}.Dlj8CW_templateMode{grid-template-columns:repeat(2,minmax(0,1fr))}.Dlj8CW_templatePreview{border:0;border-left:2px solid color-mix(in srgb, var(--panel-accent) 68%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 62%, transparent);min-height:170px;max-height:170px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;-webkit-line-clamp:6;border-radius:0;-webkit-box-orient:vertical;margin:0;padding:12px 13px 12px 14px;font-size:11px;line-height:1.55;display:-webkit-box;overflow:hidden}.Dlj8CW_bug .Dlj8CW_templatePreview{border-left-color:color-mix(in srgb, var(--jira-bug) 68%, transparent)}.Dlj8CW_templateTextarea{border:0;border-left:2px solid color-mix(in srgb, var(--panel-accent) 68%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 62%, transparent);border-radius:0;min-height:170px;max-height:170px;margin:0}.Dlj8CW_skillRule{border-left:0;margin-top:0;padding:14px 2px 0}.Dlj8CW_templatePanel>.Dlj8CW_pickerField{border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 72%, transparent);grid-template-columns:96px minmax(0,1fr);align-items:center;gap:12px;margin-top:12px;padding-top:12px;display:grid}.Dlj8CW_templatePanel>.Dlj8CW_pickerField .Dlj8CW_choiceTrigger{border-color:color-mix(in srgb, var(--panel-accent) 22%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--panel-accent) 5%, var(--dsw-alias-bg-layer-3));min-height:38px;box-shadow:0 1px 2px #1018280a}.Dlj8CW_templatePanel>.Dlj8CW_pickerField .Dlj8CW_choiceTrigger:hover,.Dlj8CW_templatePanel>.Dlj8CW_pickerField .Dlj8CW_choiceTriggerOpen{border-color:color-mix(in srgb, var(--panel-accent) 44%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--panel-accent) 8%, var(--dsw-alias-bg-layer-3))}.Dlj8CW_choicePicker{gap:6px;display:grid;position:relative}.Dlj8CW_choiceTrigger{appearance:none;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 86%, transparent);background:var(--dsw-alias-bg-layer-3);width:100%;min-height:44px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-align:left;border-radius:4px;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:7px 8px 7px 12px;transition:border-color .14s,background .14s,box-shadow .14s;display:grid;box-shadow:0 1px 2px #1018280a}.Dlj8CW_choiceTrigger:hover,.Dlj8CW_choiceTriggerOpen{border-color:color-mix(in srgb, var(--jira-accent) 43%, var(--dsw-alias-border-l2));background:var(--dsw-alias-bg-layer-3);box-shadow:0 0 0 3px color-mix(in srgb, var(--jira-accent) 7%, transparent)}.Dlj8CW_choiceTrigger strong,.Dlj8CW_choiceTrigger small{text-overflow:ellipsis;white-space:nowrap;display:block;overflow:hidden}.Dlj8CW_choiceTrigger strong{font-size:12px;font-weight:620}.Dlj8CW_choiceTrigger small{color:var(--dsw-alias-label-tertiary);margin-top:1px;font-size:9px}.Dlj8CW_choiceAffordance{flex:none;align-items:center;gap:7px;display:inline-flex}.Dlj8CW_choiceAction{color:var(--jira-accent);white-space:nowrap;font-size:10px;font-weight:650}.Dlj8CW_bug .Dlj8CW_choiceAction{color:var(--jira-bug)}.Dlj8CW_choiceChevron{background:color-mix(in srgb, var(--jira-accent) 7%, var(--dsw-alias-bg-layer-2));border-radius:4px;place-items:center;width:26px;height:26px;transition:background .14s,transform .14s;display:grid;position:relative}.Dlj8CW_choiceChevron:before{border-right:1.5px solid var(--dsw-alias-label-secondary);border-bottom:1.5px solid var(--dsw-alias-label-secondary);content:"";width:6px;height:6px;transform:translateY(-2px)rotate(45deg)}.Dlj8CW_choiceTriggerOpen .Dlj8CW_choiceChevron{background:color-mix(in srgb, var(--jira-accent) 13%, var(--dsw-alias-bg-layer-2));transform:rotate(180deg)}.Dlj8CW_choiceTriggerOpen .Dlj8CW_choiceChevron:before{border-color:var(--jira-accent)}.Dlj8CW_choicePanel{z-index:40;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:6px;gap:5px;padding:7px;display:grid;position:absolute;top:calc(100% + 6px);left:0;right:0;box-shadow:0 14px 34px #10182824}.Dlj8CW_choicePicker:has(.Dlj8CW_choiceTriggerOpen){z-index:40}.Dlj8CW_choiceRow{appearance:none;color:#0000;cursor:pointer;width:100%;min-height:42px;font:inherit;text-align:left;background:0 0;border:1px solid #0000;border-radius:4px;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px 8px;display:grid}.Dlj8CW_choiceRow:hover{background:var(--dsw-alias-bg-layer-2)}.Dlj8CW_choiceSelected{border-color:color-mix(in srgb, var(--jira-accent) 24%, transparent);background:var(--jira-accent-soft);color:var(--jira-accent)}.Dlj8CW_emptyList{color:var(--dsw-alias-label-tertiary);text-align:center;padding:18px 8px;font-size:11px}.Dlj8CW_imageSettings{border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 78%, transparent);max-width:980px;display:grid}.Dlj8CW_imageRouteField,.Dlj8CW_ocrToggle{border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 72%, transparent);grid-template-columns:minmax(220px,.72fr) minmax(300px,1.28fr);align-items:center;gap:28px;padding:18px 2px;display:grid}.Dlj8CW_imageRouteField>div>strong,.Dlj8CW_ocrToggle strong{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:650;display:block}.Dlj8CW_imageRouteField>div>p,.Dlj8CW_ocrToggle small{color:var(--dsw-alias-label-tertiary);margin:4px 0 0;font-size:10px;line-height:1.45;display:block}.Dlj8CW_ocrToggle{cursor:pointer}.Dlj8CW_ocrToggle input{width:16px;height:16px;accent-color:var(--jira-accent);grid-area:1/2;justify-self:end}.Dlj8CW_ocrToggle span{grid-area:1/1}.Dlj8CW_imageStrategy{color:var(--dsw-alias-label-secondary);counter-reset:image-strategy;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin:18px 0 0;padding:0;list-style:none;display:grid}.Dlj8CW_imageStrategy li{counter-increment:image-strategy;min-width:0;padding:31px 14px 4px 0;font-size:10px;line-height:1.55;position:relative}.Dlj8CW_imageStrategy li:before{border:1px solid color-mix(in srgb, var(--jira-accent) 36%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--jira-accent) 7%, var(--dsw-alias-bg-layer-3));width:22px;height:22px;color:var(--jira-accent);content:counter(image-strategy);border-radius:50%;place-items:center;font-size:10px;font-weight:700;display:grid;position:absolute;top:0;left:0}.Dlj8CW_imageStrategy li:not(:last-child):after{background:color-mix(in srgb, var(--jira-accent) 24%, var(--dsw-alias-border-l2));content:"";height:1px;position:absolute;top:11px;left:29px;right:10px}.Dlj8CW_footer{border-top:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 42%, var(--dsw-alias-bg-layer-3));justify-content:flex-end;align-items:center;gap:8px;padding:12px 18px;display:flex}.Dlj8CW_failed,.Dlj8CW_saveHint{flex:1;min-width:0}.Dlj8CW_save{background:var(--jira-accent);color:#fff}.Dlj8CW_save:hover:not(:disabled){background:color-mix(in srgb, var(--jira-accent) 88%, #000)}.Dlj8CW_refresh:disabled,.Dlj8CW_discard:disabled,.Dlj8CW_save:disabled{opacity:.42;cursor:default}@container Dlj8CW_jira-settings-content (width<=720px){.Dlj8CW_connectionGrid,.Dlj8CW_sourceGrid,.Dlj8CW_templateGrid{grid-template-columns:1fr}.Dlj8CW_sourcePanel,.Dlj8CW_templatePanel{padding:0}.Dlj8CW_sourcePanel+.Dlj8CW_sourcePanel,.Dlj8CW_templatePanel+.Dlj8CW_templatePanel{border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 82%, transparent);border-left:0;margin-top:24px;padding-top:24px;padding-left:0}.Dlj8CW_sourceToolbar{flex-direction:column;align-items:stretch}.Dlj8CW_sourceToolbar .Dlj8CW_pickerField{width:100%}.Dlj8CW_refresh{align-self:flex-start}.Dlj8CW_imageRouteField,.Dlj8CW_ocrToggle{grid-template-columns:1fr;gap:10px}.Dlj8CW_ocrToggle input,.Dlj8CW_ocrToggle span{grid-column:1}.Dlj8CW_ocrToggle input{grid-row:2;justify-self:start}.Dlj8CW_ocrToggle span{grid-row:1}.Dlj8CW_imageStrategy{grid-template-columns:1fr 1fr;row-gap:14px}}@media (width<=760px){.Dlj8CW_workspaceCard .Dlj8CW_body{grid-template-rows:auto minmax(0,1fr) auto;grid-template-columns:1fr}.Dlj8CW_workspaceCard .Dlj8CW_settingsNav{grid-area:1/1}.Dlj8CW_workspaceCard .Dlj8CW_settingsContent{grid-area:2/1}.Dlj8CW_workspaceCard .Dlj8CW_footer{grid-area:3/1}.Dlj8CW_settingsNav{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2);flex-direction:row;padding:9px 12px;overflow-x:auto}.Dlj8CW_settingsNavItem{min-width:145px;padding-left:10px}.Dlj8CW_settingsNavItem:before{width:auto;height:2px;inset:auto 10px 0}.Dlj8CW_connectionGrid,.Dlj8CW_sourceGrid,.Dlj8CW_templateGrid{grid-template-columns:1fr}.Dlj8CW_sourcePanel,.Dlj8CW_templatePanel{padding:0}.Dlj8CW_sourcePanel+.Dlj8CW_sourcePanel,.Dlj8CW_templatePanel+.Dlj8CW_templatePanel{border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 82%, transparent);border-left:0;margin-top:24px;padding-top:24px;padding-left:0}.Dlj8CW_sourceToolbar{flex-direction:column;align-items:stretch}.Dlj8CW_sourceToolbar .Dlj8CW_pickerField{width:100%}.Dlj8CW_refresh{align-self:flex-start}.Dlj8CW_footer{flex-wrap:wrap;align-items:stretch}.Dlj8CW_pluginCard .Dlj8CW_footer{grid-template-columns:1fr auto auto}.Dlj8CW_failed,.Dlj8CW_saveHint{flex-basis:100%;width:100%}}@media (prefers-reduced-motion:reduce){.Dlj8CW_refreshIconBusy{animation:none}}';
var tagId = "@jira-workbench/dsh-client/JiraConfigCard.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@jira-workbench/dsh-client";
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
var JiraConfigCard_default = { "body": "Dlj8CW_body", "brandMark": "Dlj8CW_brandMark", "bug": "Dlj8CW_bug", "card": "Dlj8CW_card", "cardOpen": "Dlj8CW_cardOpen", "chevron": "Dlj8CW_chevron", "chevronOpen": "Dlj8CW_chevronOpen", "choiceAction": "Dlj8CW_choiceAction", "choiceAffordance": "Dlj8CW_choiceAffordance", "choiceChevron": "Dlj8CW_choiceChevron", "choiceList": "Dlj8CW_choiceList", "choicePanel": "Dlj8CW_choicePanel", "choicePicker": "Dlj8CW_choicePicker", "choiceRow": "Dlj8CW_choiceRow", "choiceSelected": "Dlj8CW_choiceSelected", "choiceTrigger": "Dlj8CW_choiceTrigger", "choiceTriggerOpen": "Dlj8CW_choiceTriggerOpen", "connectionGrid": "Dlj8CW_connectionGrid", "description": "Dlj8CW_description", "discard": "Dlj8CW_discard", "emptyList": "Dlj8CW_emptyList", "failed": "Dlj8CW_failed", "field": "Dlj8CW_field", "filterList": "Dlj8CW_filterList", "filterPicker": "Dlj8CW_filterPicker", "filterRow": "Dlj8CW_filterRow", "filterSelected": "Dlj8CW_filterSelected", "footer": "Dlj8CW_footer", "headText": "Dlj8CW_headText", "header": "Dlj8CW_header", "hint": "Dlj8CW_hint", "imageRouteField": "Dlj8CW_imageRouteField", "imageSettings": "Dlj8CW_imageSettings", "imageStrategy": "Dlj8CW_imageStrategy", "input": "Dlj8CW_input", "inputInvalid": "Dlj8CW_inputInvalid", "invalid": "Dlj8CW_invalid", "jira-settings-content": "Dlj8CW_jira-settings-content", "kindDot": "Dlj8CW_kindDot", "label": "Dlj8CW_label", "labelRow": "Dlj8CW_labelRow", "loading": "Dlj8CW_loading", "modeHint": "Dlj8CW_modeHint", "name": "Dlj8CW_name", "ocrToggle": "Dlj8CW_ocrToggle", "optionMessage": "Dlj8CW_optionMessage", "panelTitle": "Dlj8CW_panelTitle", "pending": "Dlj8CW_pending", "pickerField": "Dlj8CW_pickerField", "pluginCard": "Dlj8CW_pluginCard", "pluginConnectionHead": "Dlj8CW_pluginConnectionHead", "pluginSettingsNote": "Dlj8CW_pluginSettingsNote", "readOnly": "Dlj8CW_readOnly", "refresh": "Dlj8CW_refresh", "refreshIcon": "Dlj8CW_refreshIcon", "refreshIconBusy": "Dlj8CW_refreshIconBusy", "refreshSpin": "Dlj8CW_refreshSpin", "save": "Dlj8CW_save", "saveHint": "Dlj8CW_saveHint", "searchInput": "Dlj8CW_searchInput", "section": "Dlj8CW_section", "sectionHeading": "Dlj8CW_sectionHeading", "segment": "Dlj8CW_segment", "segmentActive": "Dlj8CW_segmentActive", "segmented": "Dlj8CW_segmented", "settingsContent": "Dlj8CW_settingsContent", "settingsNav": "Dlj8CW_settingsNav", "settingsNavItem": "Dlj8CW_settingsNavItem", "settingsNavItemActive": "Dlj8CW_settingsNavItemActive", "skillRule": "Dlj8CW_skillRule", "sourceGrid": "Dlj8CW_sourceGrid", "sourcePanel": "Dlj8CW_sourcePanel", "sourceToolbar": "Dlj8CW_sourceToolbar", "status": "Dlj8CW_status", "statusOk": "Dlj8CW_statusOk", "templateGrid": "Dlj8CW_templateGrid", "templateMode": "Dlj8CW_templateMode", "templateModeActive": "Dlj8CW_templateModeActive", "templatePanel": "Dlj8CW_templatePanel", "templatePreview": "Dlj8CW_templatePreview", "templateState": "Dlj8CW_templateState", "templateTextarea": "Dlj8CW_templateTextarea", "textarea": "Dlj8CW_textarea", "workspaceCard": "Dlj8CW_workspaceCard" };

// src/client/JiraConfigCard.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function JiraConfigCard(props) {
  const { t } = props;
  const state = props.useJiraConfigCard((snapshot2) => snapshot2);
  const standalone = props.standalone === true;
  const [open, setOpen] = (0, import_react.useState)(standalone);
  const [section, setSection] = (0, import_react.useState)("connection");
  const settingsContentRef = (0, import_react.useRef)(null);
  const sectionRefs = (0, import_react.useRef)({
    connection: null,
    templates: null,
    images: null,
    sources: null
  });
  (0, import_react.useEffect)(() => {
    const content = settingsContentRef.current;
    if (!standalone || state.loading || !content) return;
    const order = ["connection", "templates", "images", "sources"];
    const syncSection = () => {
      const contentTop = content.getBoundingClientRect().top;
      let next = order[0];
      for (const key of order) {
        const target = sectionRefs.current[key];
        if (target && target.getBoundingClientRect().top - contentTop <= 72) next = key;
      }
      if (content.scrollHeight - content.scrollTop - content.clientHeight <= 8) next = order[order.length - 1];
      setSection((current) => current === next ? current : next);
    };
    content.addEventListener("scroll", syncSection, { passive: true });
    syncSection();
    return () => {
      content.removeEventListener("scroll", syncSection);
    };
  }, [standalone, state.loading]);
  const scrollToSection = (next) => {
    const content = settingsContentRef.current;
    const target = sectionRefs.current[next];
    if (!content || !target) return;
    const top = target.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    setSection(next);
    content.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  };
  const title = t("card.title");
  const blocked = !state.dirty || state.invalid || state.saving || state.loading;
  const projectChoices = state.projects.map((project) => ({
    value: project.key,
    label: `${project.key} \xB7 ${project.name}`,
    meta: project.id
  }));
  const discoveredVisionChoices = state.visionModels.map((model) => ({
    value: `${model.provider}\0${model.id}`,
    label: model.name,
    meta: `${model.providerName} \xB7 ${model.id}`
  }));
  const selectedVision = state.imageProcessing.visionProvider && state.imageProcessing.visionModel ? `${state.imageProcessing.visionProvider}\0${state.imageProcessing.visionModel}` : "";
  const visionChoices = selectedVision && !discoveredVisionChoices.some((choice) => choice.value === selectedVision) ? [{
    value: selectedVision,
    label: state.imageProcessing.visionModel,
    meta: `${state.imageProcessing.visionProvider} \xB7 ${t("card.visionModelUnavailable")}`
  }, ...discoveredVisionChoices] : discoveredVisionChoices;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: clsx_default(
    JiraConfigCard_default.card,
    open && JiraConfigCard_default.cardOpen,
    standalone ? JiraConfigCard_default.workspaceCard : JiraConfigCard_default.pluginCard
  ), children: [
    !standalone ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: JiraConfigCard_default.header,
        "aria-expanded": open,
        "aria-label": `${open ? "Collapse" : "Expand"}: ${title}`,
        onClick: () => {
          setOpen(!open);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: JiraConfigCard_default.brandMark, children: "JW" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: JiraConfigCard_default.headText, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: JiraConfigCard_default.name, children: title }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: JiraConfigCard_default.description, children: t("card.pluginDescription") })
          ] }),
          state.dirty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: JiraConfigCard_default.pending, children: t("card.unsaved") }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconChevronDownOutline14, { className: clsx_default(JiraConfigCard_default.chevron, open && JiraConfigCard_default.chevronOpen) })
        ]
      }
    ) : null,
    open || standalone ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.body, children: [
      standalone ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", { className: JiraConfigCard_default.settingsNav, "aria-label": t("card.settingsGroups"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          SettingsNavItem,
          {
            active: section === "connection",
            target: "jira-settings-connection",
            title: t("card.connection"),
            copy: t("card.connectionNavHint"),
            onClick: () => {
              scrollToSection("connection");
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          SettingsNavItem,
          {
            active: section === "templates",
            target: "jira-settings-templates",
            title: t("card.templatesNav"),
            copy: t("card.templatesNavHint"),
            onClick: () => {
              scrollToSection("templates");
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          SettingsNavItem,
          {
            active: section === "images",
            target: "jira-settings-images",
            title: t("card.imagesNav"),
            copy: t("card.imagesNavHint"),
            onClick: () => {
              scrollToSection("images");
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          SettingsNavItem,
          {
            active: section === "sources",
            target: "jira-settings-sources",
            title: t("card.advancedNav"),
            copy: t("card.advancedNavHint"),
            onClick: () => {
              scrollToSection("sources");
            }
          }
        )
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: settingsContentRef, className: JiraConfigCard_default.settingsContent, children: [
        state.loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: JiraConfigCard_default.loading, children: t("card.loading") }) : null,
        !state.loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "section",
          {
            id: "jira-settings-connection",
            ref: (element) => {
              sectionRefs.current.connection = element;
            },
            className: JiraConfigCard_default.section,
            children: [
              standalone ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionHeading, { title: t("card.connection"), copy: t("card.connectionHint") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.pluginConnectionHead, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: t("card.connection") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("card.connectionHint") })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: clsx_default(JiraConfigCard_default.status, state.tokenConfigured && JiraConfigCard_default.statusOk), children: t(state.tokenConfigured ? "card.tokenConfigured" : "card.tokenUnconfigured") })
              ] }),
              !state.writable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: JiraConfigCard_default.readOnly, role: "status", children: t("card.readOnly") }) : null,
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.connectionGrid, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  Field,
                  {
                    id: "jira-config-base-url",
                    label: t("card.baseUrl"),
                    hint: t("card.baseUrlHint"),
                    text: state.baseUrlText,
                    invalid: state.baseUrlInvalid,
                    invalidLabel: t("card.invalidUrl"),
                    disabled: !state.writable,
                    onEdit: (text2) => {
                      props.edit("baseUrl", text2);
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.field, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.labelRow, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: JiraConfigCard_default.label, htmlFor: "jira-config-token", children: t("card.token") }),
                    standalone ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: clsx_default(JiraConfigCard_default.status, state.tokenConfigured && JiraConfigCard_default.statusOk), children: t(state.tokenConfigured ? "card.tokenConfigured" : "card.tokenUnconfigured") }) : null
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "input",
                    {
                      id: "jira-config-token",
                      className: JiraConfigCard_default.input,
                      type: "password",
                      autoComplete: "off",
                      value: state.tokenText,
                      disabled: !state.writable || !state.tokenWritable,
                      placeholder: state.tokenConfigured ? t("card.tokenKeep") : t("card.tokenRequired"),
                      onChange: (event) => {
                        props.edit("token", event.target.value);
                      }
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: JiraConfigCard_default.hint, children: t("card.tokenHint") })
                ] })
              ] }),
              !standalone ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: JiraConfigCard_default.pluginSettingsNote, children: t("card.pluginSettingsHint") }) : null
            ]
          }
        ) : null,
        !state.loading && standalone ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "section",
          {
            id: "jira-settings-templates",
            ref: (element) => {
              sectionRefs.current.templates = element;
            },
            className: JiraConfigCard_default.section,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionHeading, { title: t("card.templates"), copy: t("card.templatesHint") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.templateGrid, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  TemplateEditor,
                  {
                    kind: "requirement",
                    title: t("card.requirementTemplate"),
                    accent: "requirement",
                    value: state.promptTemplates.requirement,
                    skills: state.skills,
                    onPatch: (patch) => {
                      props.editTemplate("requirement", patch);
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  TemplateEditor,
                  {
                    kind: "bug",
                    title: t("card.bugTemplate"),
                    accent: "bug",
                    value: state.promptTemplates.bug,
                    skills: state.skills,
                    onPatch: (patch) => {
                      props.editTemplate("bug", patch);
                    }
                  }
                )
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: JiraConfigCard_default.skillRule, children: t("card.skillRule") })
            ]
          }
        ) : null,
        !state.loading && standalone ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "section",
          {
            id: "jira-settings-images",
            ref: (element) => {
              sectionRefs.current.images = element;
            },
            className: JiraConfigCard_default.section,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionHeading, { title: t("card.images"), copy: t("card.imagesHint") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.imageSettings, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.imageRouteField, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("card.visionModel") }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("card.visionModelHint") })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    ChoicePicker,
                    {
                      id: "jira-vision-model",
                      value: selectedVision,
                      options: visionChoices,
                      placeholder: t("card.visionModelNone"),
                      searchPlaceholder: t("card.visionModelSearch"),
                      emptyText: t("card.visionModelEmpty"),
                      clearable: true,
                      actionLabel: selectedVision ? t("card.visionModelChange") : t("card.visionModelChoose"),
                      onChange: (value) => {
                        const selected = state.visionModels.find((model) => `${model.provider}\0${model.id}` === value);
                        props.editImageProcessing({
                          visionProvider: selected?.provider || "",
                          visionModel: selected?.id || ""
                        });
                      }
                    }
                  )
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: JiraConfigCard_default.ocrToggle, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "input",
                    {
                      type: "checkbox",
                      checked: state.imageProcessing.localOcrEnabled,
                      onChange: (event) => {
                        props.editImageProcessing({ localOcrEnabled: event.target.checked });
                      }
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("card.localOcr") }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: t("card.localOcrHint") })
                  ] })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", { className: JiraConfigCard_default.imageStrategy, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t("card.imageStrategyNative") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t("card.imageStrategyVision") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t("card.imageStrategyOcr") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t("card.imageStrategyUnparsed") })
                ] })
              ] })
            ]
          }
        ) : null,
        !state.loading && standalone ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "section",
          {
            id: "jira-settings-sources",
            ref: (element) => {
              sectionRefs.current.sources = element;
            },
            className: JiraConfigCard_default.section,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionHeading, { title: t("card.sources"), copy: t("card.sourcesHint") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.sourceToolbar, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.pickerField, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: JiraConfigCard_default.label, children: t("card.projectKey") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    ChoicePicker,
                    {
                      id: "jira-project-picker",
                      value: state.boardSources.projectKey,
                      options: projectChoices,
                      placeholder: t("card.projectPlaceholder"),
                      searchPlaceholder: t("card.searchProject"),
                      emptyText: t("card.noProjects"),
                      allowCustom: true,
                      onChange: props.editProjectKey
                    }
                  )
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "button",
                  {
                    type: "button",
                    className: JiraConfigCard_default.refresh,
                    disabled: state.optionsLoading,
                    onClick: props.refreshOptions,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: clsx_default(JiraConfigCard_default.refreshIcon, state.optionsLoading && JiraConfigCard_default.refreshIconBusy), "aria-hidden": "true", children: "\u21BB" }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t(state.optionsLoading ? "card.refreshing" : "card.refreshOptions") })
                    ]
                  }
                )
              ] }),
              state.optionsMessage ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: JiraConfigCard_default.optionMessage, children: state.optionsMessage }) : null,
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.sourceGrid, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  SourceEditor,
                  {
                    kind: "requirement",
                    title: t("card.requirementSource"),
                    accent: "requirement",
                    source: state.boardSources.requirement,
                    filters: state.filters,
                    onPatch: (patch) => {
                      props.editBoardSource("requirement", patch);
                    },
                    onToggleFilter: (filterId) => {
                      props.toggleFilter("requirement", filterId);
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  SourceEditor,
                  {
                    kind: "bug",
                    title: t("card.bugSource"),
                    accent: "bug",
                    source: state.boardSources.bug,
                    filters: state.filters,
                    onPatch: (patch) => {
                      props.editBoardSource("bug", patch);
                    },
                    onToggleFilter: (filterId) => {
                      props.toggleFilter("bug", filterId);
                    }
                  }
                )
              ] })
            ]
          }
        ) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.footer, children: [
        state.failed ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: JiraConfigCard_default.failed, role: "status", children: state.failureMessage || t("card.saveFailed") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: JiraConfigCard_default.saveHint, children: t(standalone ? "card.saveHint" : "card.connectionSaveHint") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: JiraConfigCard_default.discard,
            disabled: !state.dirty || state.saving,
            onClick: props.discard,
            children: t("card.discard")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: JiraConfigCard_default.save,
            disabled: blocked,
            onClick: props.save,
            children: t(state.saving ? "card.saving" : "card.save")
          }
        )
      ] })
    ] }) : null
  ] });
}
function SettingsNavItem(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      className: clsx_default(JiraConfigCard_default.settingsNavItem, props.active && JiraConfigCard_default.settingsNavItemActive),
      "aria-current": props.active ? "location" : void 0,
      "aria-controls": props.target,
      onClick: props.onClick,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: props.title }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: props.copy })
      ]
    }
  );
}
function SectionHeading(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: JiraConfigCard_default.sectionHeading, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: props.title }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: props.copy })
  ] });
}
function Field(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.field, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: JiraConfigCard_default.label, htmlFor: props.id, children: props.label }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        id: props.id,
        className: props.invalid ? JiraConfigCard_default.inputInvalid : JiraConfigCard_default.input,
        type: "text",
        "aria-invalid": props.invalid || void 0,
        value: props.text,
        disabled: props.disabled,
        onChange: (event) => {
          props.onEdit(event.target.value);
        }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: props.invalid ? JiraConfigCard_default.invalid : JiraConfigCard_default.hint, children: props.invalid ? props.invalidLabel : props.hint })
  ] });
}
function SourceEditor(props) {
  const [search, setSearch] = (0, import_react.useState)("");
  const visibleFilters = (0, import_react.useMemo)(() => {
    const needle = search.trim().toLocaleLowerCase("zh-CN");
    if (!needle) return props.filters;
    return props.filters.filter((filter) => [filter.id, filter.name, filter.owner].some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(needle)));
  }, [props.filters, search]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: clsx_default(JiraConfigCard_default.sourcePanel, JiraConfigCard_default[props.accent]), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.panelTitle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: JiraConfigCard_default.kindDot }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: props.title })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SegmentedMode, { value: props.source.mode, onChange: (mode) => {
      props.onPatch({ mode });
    } }),
    props.source.mode === "builtin" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: JiraConfigCard_default.modeHint, children: "\u6309\u9879\u76EE\u3001\u5F53\u524D\u7528\u6237\u548C Issue \u7C7B\u578B\u751F\u6210\u901A\u7528 JQL\u3002" }) : null,
    props.source.mode === "custom" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: JiraConfigCard_default.field, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: JiraConfigCard_default.label, children: "JQL" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "textarea",
        {
          className: JiraConfigCard_default.textarea,
          rows: 5,
          spellCheck: false,
          value: props.source.jql,
          placeholder: "project = PROJECT AND assignee = currentUser()",
          onChange: (event) => {
            props.onPatch({ jql: event.target.value });
          }
        }
      )
    ] }) : null,
    props.source.mode === "custom" && props.source.jql.trim() === "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: JiraConfigCard_default.invalid, children: "\u8BF7\u586B\u5199\u8BE5\u9762\u677F\u7684 JQL\u3002" }) : null,
    props.source.mode === "filter" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.filterPicker, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          className: JiraConfigCard_default.searchInput,
          type: "search",
          placeholder: "\u641C\u7D22 Filter",
          value: search,
          onChange: (event) => {
            setSearch(event.target.value);
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: JiraConfigCard_default.filterList, children: visibleFilters.length ? visibleFilters.map((filter) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: clsx_default(JiraConfigCard_default.filterRow, props.source.filterIds.includes(filter.id) && JiraConfigCard_default.filterSelected), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: props.source.filterIds.includes(filter.id),
            onChange: () => {
              props.onToggleFilter(filter.id);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: filter.name }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
            "#",
            filter.id,
            filter.owner ? ` \xB7 ${filter.owner}` : "",
            filter.favourite ? " \xB7 \u6536\u85CF" : "",
            filter.projectMatch === "match" ? " \xB7 \u5F53\u524D\u9879\u76EE" : filter.projectMatch === "other" ? " \xB7 \u5176\u4ED6\u9879\u76EE" : filter.projectMatch === "unknown" ? " \xB7 \u8303\u56F4\u5F85\u786E\u8BA4" : ""
          ] })
        ] })
      ] }, filter.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: JiraConfigCard_default.emptyList, children: "\u6CA1\u6709\u53EF\u7528 Filter" }) })
    ] }) : null,
    props.source.mode === "filter" && props.source.filterIds.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: JiraConfigCard_default.invalid, children: "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A Jira Filter\u3002" }) : null
  ] });
}
function SegmentedMode(props) {
  const modes = [
    ["builtin", "\u901A\u7528 JQL"],
    ["custom", "\u81EA\u5B9A\u4E49"],
    ["filter", "Jira Filter"]
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: JiraConfigCard_default.segmented, role: "radiogroup", "aria-label": "\u4EFB\u52A1\u6765\u6E90\u65B9\u5F0F", children: modes.map(([value, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      className: clsx_default(JiraConfigCard_default.segment, props.value === value && JiraConfigCard_default.segmentActive),
      "aria-pressed": props.value === value,
      onClick: () => {
        props.onChange(value);
      },
      children: label
    },
    value
  )) });
}
function TemplateEditor(props) {
  const skillChoices = props.skills.map((skill) => ({
    value: skill.name,
    label: skill.name,
    meta: skill.scopes.length ? skill.scopes.join("\u3001") : skill.source
  }));
  const selectedSkill = props.value.skill?.name || "";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: clsx_default(JiraConfigCard_default.templatePanel, JiraConfigCard_default[props.accent]), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.panelTitle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: JiraConfigCard_default.kindDot }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: props.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: JiraConfigCard_default.templateState, children: props.value.customized ? "\u81EA\u5B9A\u4E49" : "\u7CFB\u7EDF\u9ED8\u8BA4" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.templateMode, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: clsx_default(!props.value.customized && JiraConfigCard_default.templateModeActive),
          onClick: () => {
            props.onPatch({ customized: false });
          },
          children: "\u7CFB\u7EDF\u9ED8\u8BA4"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: clsx_default(props.value.customized && JiraConfigCard_default.templateModeActive),
          onClick: () => {
            props.onPatch({ customized: true });
          },
          children: "\u81EA\u5B9A\u4E49\u6A21\u677F"
        }
      )
    ] }),
    props.value.customized ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "textarea",
      {
        className: JiraConfigCard_default.templateTextarea,
        rows: 8,
        maxLength: 12e3,
        spellCheck: false,
        value: props.value.content,
        onChange: (event) => {
          props.onPatch({ content: event.target.value });
        }
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: JiraConfigCard_default.templatePreview, children: props.value.content }),
    props.value.customized && props.value.content.trim() === "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: JiraConfigCard_default.invalid, children: "\u81EA\u5B9A\u4E49\u6A21\u677F\u4E0D\u80FD\u4E3A\u7A7A\u3002" }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.pickerField, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: JiraConfigCard_default.label, children: "\u7ED1\u5B9A DSH Skill" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ChoicePicker,
        {
          id: `jira-${props.kind}-skill`,
          value: selectedSkill,
          options: skillChoices,
          placeholder: "\u4E0D\u7ED1\u5B9A Skill",
          searchPlaceholder: "\u641C\u7D22 DSH Skill",
          emptyText: "\u5F53\u524D\u6CA1\u6709\u53EF\u7ED1\u5B9A\u7684 Skill",
          clearable: true,
          actionLabel: selectedSkill ? "\u66F4\u6539 Skill" : "\u9009\u62E9 Skill",
          onChange: (name) => {
            const skill = props.skills.find((candidate) => candidate.name === name);
            props.onPatch({
              skill: skill ? { name: skill.name, path: skill.path || "", scope: "dsh" } : null
            });
          }
        }
      )
    ] })
  ] });
}
function ChoicePicker(props) {
  const [open, setOpen] = (0, import_react.useState)(false);
  const [search, setSearch] = (0, import_react.useState)("");
  const pickerRef = (0, import_react.useRef)(null);
  const triggerRef = (0, import_react.useRef)(null);
  const selected = props.options.find((option) => option.value === props.value);
  const triggerLabel = selected?.label || props.value || props.placeholder;
  const needle = search.trim().toLocaleLowerCase("zh-CN");
  const visible = props.options.filter((option) => !needle || `${option.label} ${option.meta || ""}`.toLocaleLowerCase("zh-CN").includes(needle));
  const customValue = search.trim().toUpperCase();
  const canUseCustom = props.allowCustom === true && /^[A-Z][A-Z0-9_]{0,49}$/.test(customValue) && !props.options.some((option) => option.value === customValue);
  const choose = (value) => {
    props.onChange(value);
    setSearch("");
    setOpen(false);
  };
  (0, import_react.useEffect)(() => {
    if (!open) return;
    const close = () => {
      setSearch("");
      setOpen(false);
    };
    const onPointerDown = (event) => {
      if (!pickerRef.current?.contains(event.target)) close();
    };
    const onFocusIn = (event) => {
      if (!pickerRef.current?.contains(event.target)) close();
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: pickerRef, className: JiraConfigCard_default.choicePicker, id: props.id, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        ref: triggerRef,
        type: "button",
        className: clsx_default(JiraConfigCard_default.choiceTrigger, props.actionLabel && JiraConfigCard_default.choiceTriggerActionable, open && JiraConfigCard_default.choiceTriggerOpen),
        "aria-haspopup": "listbox",
        "aria-expanded": open,
        "aria-controls": `${props.id}-listbox`,
        "aria-label": props.actionLabel ? `${props.actionLabel}\uFF1A${triggerLabel}` : void 0,
        onClick: () => {
          if (open) setSearch("");
          setOpen(!open);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: triggerLabel }),
            selected?.meta ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: selected.meta }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: JiraConfigCard_default.choiceAffordance, "aria-hidden": "true", children: [
            props.actionLabel ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: JiraConfigCard_default.choiceAction, children: props.actionLabel }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: JiraConfigCard_default.choiceChevron })
          ] })
        ]
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: JiraConfigCard_default.choicePanel, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          autoFocus: true,
          className: JiraConfigCard_default.searchInput,
          type: "search",
          placeholder: props.searchPlaceholder,
          value: search,
          onChange: (event) => {
            setSearch(event.target.value);
          },
          onKeyDown: (event) => {
            if (event.key === "Enter" && canUseCustom) choose(customValue);
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { id: `${props.id}-listbox`, className: JiraConfigCard_default.choiceList, role: "listbox", children: [
        props.clearable && !needle ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: clsx_default(JiraConfigCard_default.choiceRow, props.value === "" && JiraConfigCard_default.choiceSelected), onClick: () => {
          choose("");
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: props.placeholder }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "\u4F7F\u7528\u6A21\u677F\u964D\u7EA7\u7B56\u7565" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u2713" })
        ] }) : null,
        visible.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            className: clsx_default(JiraConfigCard_default.choiceRow, props.value === option.value && JiraConfigCard_default.choiceSelected),
            role: "option",
            "aria-selected": props.value === option.value,
            onClick: () => {
              choose(option.value);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: option.label }),
                option.meta ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: option.meta }) : null
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u2713" })
            ]
          },
          option.value
        )),
        canUseCustom ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: JiraConfigCard_default.choiceRow, onClick: () => {
          choose(customValue);
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
              "\u4F7F\u7528\u9879\u76EE Key \u201C",
              customValue,
              "\u201D"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "\u672A\u51FA\u73B0\u5728 Jira \u9879\u76EE\u5217\u8868\u4E2D" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\uFF0B" })
        ] }) : null,
        !visible.length && !canUseCustom ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: JiraConfigCard_default.emptyList, children: props.emptyText }) : null
      ] })
    ] }) : null
  ] });
}

// src/client/JiraPanel.tsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/jira-workspace-store.ts
var snapshot = {
  open: false,
  route: { kind: "board" },
  revision: 0
};
var listeners = /* @__PURE__ */ new Set();
function publish(next) {
  snapshot = { ...next, revision: snapshot.revision + 1 };
  for (const listener of listeners) listener();
}
var jiraWorkspaceStore = {
  getSnapshot() {
    return snapshot;
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  open(route = { kind: "board" }) {
    publish({ open: true, route });
  },
  close() {
    if (!snapshot.open) return;
    publish({ open: false, route: snapshot.route });
  },
  toggleBoard() {
    if (snapshot.open && snapshot.route.kind === "board") {
      publish({ open: false, route: snapshot.route });
      return;
    }
    publish({ open: true, route: { kind: "board" } });
  }
};

// src/client/JiraPanel.module.css
var css2 = ".LNAc4a_root{display:flex}.LNAc4a_trigger{appearance:none;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:8px;align-items:center;gap:8px;padding:6px 10px;line-height:1;transition:color .14s,background-color .14s;display:flex}.LNAc4a_trigger:hover,.LNAc4a_triggerActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}.LNAc4a_triggerActive{color:#5272d2;background:color-mix(in srgb, #5272d2 11%, var(--dsw-alias-bg-layer-3))}.LNAc4a_trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.LNAc4a_label{font-size:13px;line-height:1.5}";
var tagId2 = "@jira-workbench/dsh-client/JiraPanel.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId2) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@jira-workbench/dsh-client";
  tag.dataset.pluginCss = tagId2;
  tag.textContent = css2;
  document.head.appendChild(tag);
}
var JiraPanel_default = { "label": "LNAc4a_label", "root": "LNAc4a_root", "trigger": "LNAc4a_trigger", "triggerActive": "LNAc4a_triggerActive" };

// src/client/JiraPanel.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function JiraPanel(props) {
  const { t, wide } = props;
  const snapshot2 = (0, import_react2.useSyncExternalStore)(
    jiraWorkspaceStore.subscribe,
    jiraWorkspaceStore.getSnapshot,
    jiraWorkspaceStore.getSnapshot
  );
  const active = snapshot2.open && snapshot2.route.kind === "board";
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: JiraPanel_default.root, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "button",
    {
      type: "button",
      "data-jira-workbench-trigger": true,
      className: active ? `${JiraPanel_default.trigger} ${JiraPanel_default.triggerActive}` : JiraPanel_default.trigger,
      "aria-label": t("panel.aria"),
      "aria-pressed": active,
      onClick: () => {
        jiraWorkspaceStore.toggleBoard();
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconChecklistOutline14, {}),
        wide && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: JiraPanel_default.label, children: t("panel.trigger") })
      ]
    }
  ) });
}

// src/client/JiraSessionContext.tsx
var import_react3 = require("react");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/JiraSessionContext.module.css
var css3 = ".pzTNzW_root{display:inline-flex;position:relative}.pzTNzW_trigger{background:var(--dsw-alias-bg-layer-2);max-width:min(360px,34vw);min-height:28px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border:1px solid #0000;border-radius:6px;align-items:center;gap:6px;padding:3px 7px;font-size:12px;line-height:18px;display:inline-flex}.pzTNzW_trigger:hover,.pzTNzW_trigger:focus-visible,.pzTNzW_trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:#0000}.pzTNzW_trigger:focus-visible,.pzTNzW_quietButton:focus-visible,.pzTNzW_iconButton:focus-visible,.pzTNzW_secondaryButton:focus-visible,.pzTNzW_primaryButton:focus-visible,.pzTNzW_dangerButton:focus-visible,.pzTNzW_confirmButton:focus-visible,.pzTNzW_moreDanger:focus-visible,.pzTNzW_link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.pzTNzW_triggerError{color:var(--dsw-alias-state-warn-primary)}.pzTNzW_triggerLabel{font-family:var(--dsw-font-mono);font-weight:600}.pzTNzW_triggerTypeBug,.pzTNzW_triggerTypeRequirement{border-radius:4px;flex:none;justify-content:center;align-items:center;width:18px;height:18px;font-size:10px;font-weight:650;line-height:1;display:inline-flex}.pzTNzW_triggerTypeBug{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.pzTNzW_triggerTypeRequirement{background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-brand-primary)}.pzTNzW_triggerStatus{min-width:0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:11px;overflow:hidden}.pzTNzW_triggerChevron,.pzTNzW_triggerChevronOpen{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .14s}.pzTNzW_triggerChevronOpen{transform:rotate(180deg)}.pzTNzW_popover{z-index:120;box-sizing:border-box;transform-origin:100% 0;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);width:410px;max-width:min(440px,100vw - 32px);height:clamp(440px,76vh,560px);min-height:0;max-height:calc(100vh - 88px);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv3);border-radius:10px;grid-template-rows:auto minmax(0,1fr) auto auto;padding:0;display:grid;position:fixed;top:56px;right:28px;overflow:hidden}.pzTNzW_header,.pzTNzW_identity,.pzTNzW_headerActions,.pzTNzW_meta,.pzTNzW_footer,.pzTNzW_workspace,.pzTNzW_parentContext,.pzTNzW_confirmation,.pzTNzW_confirmation>div{align-items:center;display:flex}.pzTNzW_header{border-bottom:1px solid var(--dsw-alias-border-l2);justify-content:space-between;gap:12px;padding:12px 14px}.pzTNzW_identity{gap:8px;min-width:0;font-size:12px;line-height:18px}.pzTNzW_identity strong{font-family:var(--dsw-font-mono);font-weight:600}.pzTNzW_typeBug,.pzTNzW_typeRequirement{border-radius:6px;justify-content:center;align-items:center;width:20px;height:20px;font-size:11px;font-weight:600;line-height:1;display:inline-flex}.pzTNzW_typeBug{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.pzTNzW_typeRequirement{background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-brand-primary)}.pzTNzW_status{background:var(--dsw-alias-fill-l2);max-width:120px;color:var(--dsw-alias-label-secondary);white-space:nowrap;text-overflow:ellipsis;border-radius:999px;padding:1px 7px;overflow:hidden}.pzTNzW_headerActions{flex:none;gap:4px}.pzTNzW_body{scrollbar-gutter:stable;min-height:0;padding:16px;overflow:auto}.pzTNzW_moreWrap{position:relative}.pzTNzW_moreMenu{z-index:2;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);min-width:132px;box-shadow:var(--dsw-shadow-lv2);border-radius:6px;padding:4px;position:absolute;top:calc(100% + 5px);right:0}.pzTNzW_moreDanger{width:100%;min-height:30px;color:var(--dsw-alias-state-error-primary);font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:4px;padding:5px 8px;font-size:12px}.pzTNzW_moreDanger:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}.pzTNzW_quietButton,.pzTNzW_iconButton,.pzTNzW_secondaryButton,.pzTNzW_primaryButton,.pzTNzW_dangerButton,.pzTNzW_confirmButton{font:inherit;cursor:pointer;border:0;border-radius:8px}.pzTNzW_quietButton,.pzTNzW_iconButton{color:var(--dsw-alias-label-tertiary);background:0 0}.pzTNzW_quietButton{padding:4px 7px;font-size:12px;line-height:18px}.pzTNzW_quietButton:hover,.pzTNzW_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.pzTNzW_iconButton{justify-content:center;align-items:center;width:28px;height:28px;display:inline-flex}.pzTNzW_issueTitle{margin:0 0 7px;font-size:15px;font-weight:600;line-height:22px}.pzTNzW_meta{color:var(--dsw-alias-label-tertiary);flex-wrap:wrap;gap:6px 12px;font-size:12px;line-height:18px}.pzTNzW_summary{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0 0;font-size:13px;line-height:20px}.pzTNzW_workspace,.pzTNzW_parentContext{border-top:1px solid var(--dsw-alias-border-l2);min-width:0;color:var(--dsw-alias-label-tertiary);gap:8px;margin-top:12px;padding-top:10px;font-size:12px;line-height:18px}.pzTNzW_workspace strong,.pzTNzW_parentContext strong,.pzTNzW_parentContext span:last-child{min-width:0;color:var(--dsw-alias-label-secondary);white-space:nowrap;text-overflow:ellipsis;font-weight:500;overflow:hidden}.pzTNzW_parentContext span:last-child{flex:1}.pzTNzW_warning{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary);border-radius:8px;margin:10px 0 0;padding:8px 10px;font-size:12px;line-height:18px}.pzTNzW_footer{border-top:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 54%, var(--dsw-specific-menu));flex-wrap:nowrap;gap:8px;margin:0;padding:12px 14px}.pzTNzW_secondaryButton,.pzTNzW_primaryButton,.pzTNzW_dangerButton,.pzTNzW_confirmButton,.pzTNzW_link{box-sizing:border-box;min-height:30px;padding:6px 10px;font-size:12px;line-height:18px;text-decoration:none}.pzTNzW_secondaryButton{background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-brand-primary);flex:1}.pzTNzW_secondaryButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.pzTNzW_primaryButton,.pzTNzW_confirmButton{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}.pzTNzW_primaryButton{flex:1.2}.pzTNzW_primaryButton:hover,.pzTNzW_confirmButton:hover{background:var(--dsw-alias-button-primary-hover)}.pzTNzW_link{color:var(--dsw-alias-brand-primary);flex:none;align-items:center;display:inline-flex}.pzTNzW_link:hover{text-decoration:underline}.pzTNzW_dangerButton{color:var(--dsw-alias-state-error-primary);background:0 0;margin-left:auto}.pzTNzW_dangerButton:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}.pzTNzW_confirmation{border-top:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 22%, var(--dsw-alias-border-l2));background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-radius:0;justify-content:space-between;gap:12px;margin:0;padding:10px 14px;font-size:12px;line-height:18px}.pzTNzW_confirmation>div{flex:none;gap:4px}.pzTNzW_quietButton:disabled,.pzTNzW_dangerButton:disabled,.pzTNzW_confirmButton:disabled{opacity:.55;cursor:wait}@media (width<=720px){.pzTNzW_popover{width:auto;max-width:none;min-height:0;max-height:calc(100vh - 88px);position:fixed;top:56px;left:16px;right:16px}.pzTNzW_footer{flex-wrap:wrap}}@media (prefers-reduced-motion:no-preference){.pzTNzW_popover{animation:.15s ease-out pzTNzW_jira-context-enter}.pzTNzW_trigger,.pzTNzW_secondaryButton,.pzTNzW_primaryButton,.pzTNzW_dangerButton,.pzTNzW_iconButton{transition:background-color .12s,border-color .12s,color .12s}}@keyframes pzTNzW_jira-context-enter{0%{opacity:0;transform:translateY(-5px)scale(.98)}to{opacity:1;transform:translateY(0)scale(1)}}";
var tagId3 = "@jira-workbench/dsh-client/JiraSessionContext.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId3) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@jira-workbench/dsh-client";
  tag.dataset.pluginCss = tagId3;
  tag.textContent = css3;
  document.head.appendChild(tag);
}
var JiraSessionContext_default = { "body": "pzTNzW_body", "confirmButton": "pzTNzW_confirmButton", "confirmation": "pzTNzW_confirmation", "dangerButton": "pzTNzW_dangerButton", "footer": "pzTNzW_footer", "header": "pzTNzW_header", "headerActions": "pzTNzW_headerActions", "iconButton": "pzTNzW_iconButton", "identity": "pzTNzW_identity", "issueTitle": "pzTNzW_issueTitle", "jira-context-enter": "pzTNzW_jira-context-enter", "link": "pzTNzW_link", "meta": "pzTNzW_meta", "moreDanger": "pzTNzW_moreDanger", "moreMenu": "pzTNzW_moreMenu", "moreWrap": "pzTNzW_moreWrap", "parentContext": "pzTNzW_parentContext", "popover": "pzTNzW_popover", "primaryButton": "pzTNzW_primaryButton", "quietButton": "pzTNzW_quietButton", "root": "pzTNzW_root", "secondaryButton": "pzTNzW_secondaryButton", "status": "pzTNzW_status", "summary": "pzTNzW_summary", "trigger": "pzTNzW_trigger", "triggerChevron": "pzTNzW_triggerChevron", "triggerChevronOpen": "pzTNzW_triggerChevronOpen", "triggerError": "pzTNzW_triggerError", "triggerLabel": "pzTNzW_triggerLabel", "triggerStatus": "pzTNzW_triggerStatus", "triggerTypeBug": "pzTNzW_triggerTypeBug", "triggerTypeRequirement": "pzTNzW_triggerTypeRequirement", "typeBug": "pzTNzW_typeBug", "typeRequirement": "pzTNzW_typeRequirement", "warning": "pzTNzW_warning", "workspace": "pzTNzW_workspace" };

// src/client/JiraSessionContext.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function useDismissOnOutsidePointer(root, open, setOpen) {
  (0, import_react3.useEffect)(() => {
    if (!open) return void 0;
    const dismiss = (event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", dismiss, true);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
    };
  }, [open, root, setOpen]);
}
function JiraSessionContext({
  sessionId,
  loadContext,
  clearContext,
  t
}) {
  const [result, setResult] = (0, import_react3.useState)(null);
  const [loadError, setLoadError] = (0, import_react3.useState)("");
  const [pending, setPending] = (0, import_react3.useState)(false);
  const [open, setOpen] = (0, import_react3.useState)(false);
  const [moreOpen, setMoreOpen] = (0, import_react3.useState)(false);
  const [confirmUnlink, setConfirmUnlink] = (0, import_react3.useState)(false);
  const rootRef = (0, import_react3.useRef)(null);
  const triggerRef = (0, import_react3.useRef)(null);
  const generationRef = (0, import_react3.useRef)(0);
  useDismissOnOutsidePointer(rootRef, open, setOpen);
  (0, import_react3.useEffect)(() => jiraWorkspaceStore.subscribe(() => {
    if (jiraWorkspaceStore.getSnapshot().open) {
      setOpen(false);
      setConfirmUnlink(false);
    }
  }), []);
  const refresh = (0, import_react3.useCallback)(async (foreground = true) => {
    const generation = ++generationRef.current;
    if (foreground) setPending(true);
    try {
      const next = await loadContext(sessionId);
      if (generation !== generationRef.current) return;
      setResult(next);
      setLoadError("");
    } catch (error) {
      if (generation !== generationRef.current) return;
      setLoadError(error instanceof Error ? error.message : t("context.loadFailed"));
    } finally {
      if (generation === generationRef.current && foreground) setPending(false);
    }
  }, [loadContext, sessionId, t]);
  (0, import_react3.useEffect)(() => {
    setResult(null);
    setLoadError("");
    setOpen(false);
    setMoreOpen(false);
    setConfirmUnlink(false);
    void refresh();
    const interval = window.setInterval(() => {
      void refresh(false);
    }, 6e4);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      generationRef.current += 1;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
  (0, import_react3.useEffect)(() => {
    if (open) return;
    setMoreOpen(false);
    setConfirmUnlink(false);
  }, [open]);
  const context = result?.context ?? null;
  const unlink = async () => {
    if (!context || !result) return;
    setPending(true);
    try {
      const revision = await clearContext({
        sessionId,
        issueKey: context.issueKey,
        expectedRevision: result.revision
      });
      setResult({ revision, context: null });
      setOpen(false);
      setConfirmUnlink(false);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("context.unlinkFailed"));
      setConfirmUnlink(false);
      await refresh(false);
    } finally {
      setPending(false);
    }
  };
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    if (moreOpen) {
      event.preventDefault();
      setMoreOpen(false);
      return;
    }
    if (confirmUnlink) {
      event.preventDefault();
      setConfirmUnlink(false);
      return;
    }
    if (open) {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };
  if (context === null && !loadError) return null;
  const issue = context?.issue;
  const projectLabel = context?.projectScopes.length ? context.projectScopes.map((scope) => scope.projectLabel).join("\u3001") : t("context.noWorkspace");
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { ref: rootRef, className: JiraSessionContext_default.root, onKeyDown, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "button",
      {
        ref: triggerRef,
        type: "button",
        className: loadError && !context ? `${JiraSessionContext_default.trigger} ${JiraSessionContext_default.triggerError}` : JiraSessionContext_default.trigger,
        "aria-expanded": open,
        "aria-label": context ? t("context.aria", { issueKey: context.issueKey }) : t("context.retry"),
        onClick: () => {
          if (!context) {
            void refresh();
            return;
          }
          setOpen((current) => !current);
          setConfirmUnlink(false);
        },
        children: [
          context && issue ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: issue.type === "bug" ? JiraSessionContext_default.triggerTypeBug : JiraSessionContext_default.triggerTypeRequirement, children: issue.type === "bug" ? "B" : "R" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.StateDot, { state: loadError ? "warning" : "ongoing" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: JiraSessionContext_default.triggerLabel, children: context ? context.issueKey : t("context.errorShort") }),
          context && issue && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: JiraSessionContext_default.triggerStatus, children: issue.statusName }),
          context && issue && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconChevronDownOutline14, { className: open ? JiraSessionContext_default.triggerChevronOpen : JiraSessionContext_default.triggerChevron })
        ]
      }
    ),
    open && context && issue ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: JiraSessionContext_default.popover, "aria-label": t("context.title"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: JiraSessionContext_default.header, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: JiraSessionContext_default.identity, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: issue.type === "bug" ? JiraSessionContext_default.typeBug : JiraSessionContext_default.typeRequirement, children: issue.type === "bug" ? "B" : "R" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: context.issueKey }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: JiraSessionContext_default.status, children: issue.statusName })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: JiraSessionContext_default.headerActions, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: JiraSessionContext_default.quietButton, disabled: pending, onClick: () => {
            void refresh();
          }, children: pending ? t("context.refreshing") : t("context.refresh") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: JiraSessionContext_default.moreWrap, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                className: JiraSessionContext_default.iconButton,
                "aria-label": t("context.more"),
                "aria-expanded": moreOpen,
                onClick: () => {
                  setMoreOpen((current) => !current);
                  setConfirmUnlink(false);
                },
                children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconEllipsisOutline16, { size: 16 })
              }
            ),
            moreOpen && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: JiraSessionContext_default.moreMenu, role: "menu", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                className: JiraSessionContext_default.moreDanger,
                role: "menuitem",
                disabled: pending,
                onClick: () => {
                  setMoreOpen(false);
                  setConfirmUnlink(true);
                },
                children: t("context.unlink")
              }
            ) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              className: JiraSessionContext_default.iconButton,
              "aria-label": t("context.collapse"),
              onClick: () => {
                setOpen(false);
                triggerRef.current?.focus();
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconCloseOutline16, { size: 14 })
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: JiraSessionContext_default.body, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { className: JiraSessionContext_default.issueTitle, children: issue.title }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: JiraSessionContext_default.meta, children: [
          issue.projectName && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: issue.projectName }),
          issue.assignee && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("context.assignee", { assignee: issue.assignee }) }),
          issue.priority && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: issue.priority })
        ] }),
        issue.summary && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: JiraSessionContext_default.summary, children: issue.summary }),
        issue.parentIssue && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: JiraSessionContext_default.parentContext, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("context.parent") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: issue.parentIssue.key }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: issue.parentIssue.title })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: JiraSessionContext_default.workspace, title: context.projectScopes.map((scope) => scope.cwd).join("\n"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("context.workspace") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: projectLabel })
        ] }),
        context.issueError && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: JiraSessionContext_default.warning, children: context.issueError.message }),
        context.workspaceError && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: JiraSessionContext_default.warning, children: context.workspaceError.message }),
        context.conflictingIssueKeys.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: JiraSessionContext_default.warning, children: t("context.conflict", { issueKeys: context.conflictingIssueKeys.join("\u3001") }) }),
        loadError && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: JiraSessionContext_default.warning, children: loadError })
      ] }),
      confirmUnlink && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: JiraSessionContext_default.confirmation, role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("context.unlinkConfirm", { issueKey: context.issueKey }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: JiraSessionContext_default.quietButton, onClick: () => {
            setConfirmUnlink(false);
          }, children: t("context.cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: JiraSessionContext_default.confirmButton, disabled: pending, onClick: () => {
            void unlink();
          }, children: pending ? t("context.unlinking") : t("context.confirm") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("footer", { className: JiraSessionContext_default.footer, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: JiraSessionContext_default.secondaryButton,
            onClick: () => {
              jiraWorkspaceStore.open({ kind: "detail", issueKey: context.issueKey, sessionId });
              setOpen(false);
            },
            children: t("context.openBoard")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: JiraSessionContext_default.primaryButton,
            onClick: () => {
              jiraWorkspaceStore.open({ kind: "svn", issueKey: context.issueKey });
              setOpen(false);
            },
            children: t("context.openSvn")
          }
        ),
        issue.url && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("a", { className: JiraSessionContext_default.link, href: issue.url, target: "_blank", rel: "noreferrer", onClick: () => {
          setOpen(false);
        }, children: t("context.openJira") })
      ] })
    ] }) : null
  ] });
}

// src/client/JiraWorkspaceSurface.tsx
var import_react4 = require("react");
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/JiraWorkspaceSurface.module.css
var css4 = ".M0OW-q_root{z-index:1;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);min-width:0;color:var(--dsw-alias-label-primary);pointer-events:auto;animation:M0OW-q_workspaceEnter .18s var(--ds-ease-out,ease-out);display:flex;position:absolute;inset:0;overflow:hidden}@keyframes M0OW-q_workspaceEnter{0%{opacity:.72;transform:translate(8px)}to{opacity:1;transform:translate(0)}}.M0OW-q_frame{background:var(--dsw-alias-bg-base);border:0;width:100%;min-width:0;height:100%}.M0OW-q_settingsRoot{flex-direction:column}.M0OW-q_frameLoading{z-index:2;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);place-content:center;justify-items:center;gap:12px;font-size:13px;display:grid;position:absolute;inset:0}.M0OW-q_spinner{border:2px solid var(--dsw-alias-border-l2);border-top-color:#5272d2;border-radius:50%;width:22px;height:22px;animation:.8s linear infinite M0OW-q_spin}@keyframes M0OW-q_spin{to{transform:rotate(360deg)}}.M0OW-q_loadingClose,.M0OW-q_backButton,.M0OW-q_iconButton{background:var(--dsw-alias-bg-layer-2);min-height:34px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;border:0;border-radius:8px;transition:background .14s,color .14s,box-shadow .14s,transform .14s}.M0OW-q_loadingClose{padding:0 13px;font-size:12px;font-weight:600}.M0OW-q_backButton{background:color-mix(in srgb, #5272d2 9%, var(--dsw-alias-bg-layer-3));color:#5272d2;align-items:center;gap:7px;padding:0 13px 0 8px;font-size:12px;font-weight:650;display:inline-flex;box-shadow:inset 0 0 0 1px #5272d226}.M0OW-q_backIcon{background:#5272d21a;border-radius:6px;place-items:center;width:21px;height:21px;font-size:14px;line-height:1;display:grid}.M0OW-q_loadingClose:hover,.M0OW-q_backButton:hover{background:color-mix(in srgb, #5272d2 14%, var(--dsw-alias-bg-layer-3));color:#5272d2}.M0OW-q_backButton:hover{transform:translateY(-1px);box-shadow:inset 0 0 0 1px #5272d23d}.M0OW-q_navigationError{z-index:3;background:color-mix(in srgb, #c8675d 13%, var(--dsw-alias-bg-layer-3));color:#c8675d;border-radius:8px;max-width:min(520px,100% - 36px);padding:10px 13px;font-size:12px;position:absolute;top:14px;right:18px;box-shadow:0 12px 28px #141b2724}.M0OW-q_settingsHeader{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);flex:none;justify-content:space-between;align-items:center;gap:18px;min-height:72px;padding:0 24px;display:flex}.M0OW-q_settingsHeader h1{margin:2px 0 0;font-size:19px;line-height:1.3}.M0OW-q_eyebrow{color:#5272d2;letter-spacing:.08em;font-size:10px;font-weight:750}.M0OW-q_settingsActions{align-items:center;gap:8px;display:flex}.M0OW-q_iconButton{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 72%, transparent);width:34px;box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-border-l2) 72%, transparent);place-items:center;padding:0;display:grid}.M0OW-q_iconButton:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}.M0OW-q_settingsBody{background:var(--dsw-alias-bg-base);flex:1;min-width:0;min-height:0;overflow:hidden}@media (prefers-reduced-motion:reduce){.M0OW-q_root,.M0OW-q_spinner{animation:none}}";
var tagId4 = "@jira-workbench/dsh-client/JiraWorkspaceSurface.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId4) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@jira-workbench/dsh-client";
  tag.dataset.pluginCss = tagId4;
  tag.textContent = css4;
  document.head.appendChild(tag);
}
var JiraWorkspaceSurface_default = { "backButton": "M0OW-q_backButton", "backIcon": "M0OW-q_backIcon", "eyebrow": "M0OW-q_eyebrow", "frame": "M0OW-q_frame", "frameLoading": "M0OW-q_frameLoading", "iconButton": "M0OW-q_iconButton", "loadingClose": "M0OW-q_loadingClose", "navigationError": "M0OW-q_navigationError", "root": "M0OW-q_root", "settingsActions": "M0OW-q_settingsActions", "settingsBody": "M0OW-q_settingsBody", "settingsHeader": "M0OW-q_settingsHeader", "settingsRoot": "M0OW-q_settingsRoot", "spin": "M0OW-q_spin", "spinner": "M0OW-q_spinner", "workspaceEnter": "M0OW-q_workspaceEnter" };

// src/client/JiraWorkspaceSurface.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function workspaceUrl(route) {
  const params = new URLSearchParams({ transport: "http", workspace: "1" });
  if (route.kind === "detail" || route.kind === "svn") params.set("issue", route.issueKey);
  if (route.kind === "detail") {
    params.set("embed", "detail");
    if (route.sessionId) params.set("currentSession", route.sessionId);
  }
  if (route.kind === "svn") params.set("svn", "1");
  return `/jira-task-board?${params.toString()}`;
}
function JiraWorkspaceSurface(props) {
  const snapshot2 = (0, import_react4.useSyncExternalStore)(
    jiraWorkspaceStore.subscribe,
    jiraWorkspaceStore.getSnapshot,
    jiraWorkspaceStore.getSnapshot
  );
  const rootRef = (0, import_react4.useRef)(null);
  const frameRef = (0, import_react4.useRef)(null);
  const detailHistoryTokenRef = (0, import_react4.useRef)("");
  const suppressHistoryPopRef = (0, import_react4.useRef)(false);
  const [sidebarInset, setSidebarInset] = (0, import_react4.useState)(0);
  const [frameReady, setFrameReady] = (0, import_react4.useState)(false);
  const [navigationError, setNavigationError] = (0, import_react4.useState)("");
  const frameUrl = (0, import_react4.useMemo)(() => workspaceUrl(snapshot2.route), [snapshot2.route]);
  (0, import_react4.useLayoutEffect)(() => {
    if (!snapshot2.open) return void 0;
    const root = rootRef.current;
    let shellOverlay = root?.parentElement ?? null;
    while (shellOverlay?.parentElement) {
      const bounds = shellOverlay.getBoundingClientRect();
      if (window.getComputedStyle(shellOverlay).position === "absolute" && bounds.width > 320 && bounds.height > 280) break;
      shellOverlay = shellOverlay.parentElement;
    }
    const appFrame = shellOverlay?.parentElement;
    const sidebar = appFrame?.firstElementChild;
    if (!(appFrame instanceof HTMLElement) || !(sidebar instanceof HTMLElement)) return void 0;
    let animationFrame = 0;
    const update = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const frameBox = appFrame.getBoundingClientRect();
        const sidebarBox = sidebar.getBoundingClientRect();
        setSidebarInset(Math.max(0, Math.round(sidebarBox.right - frameBox.left)));
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(appFrame);
    observer.observe(sidebar);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [snapshot2.open]);
  (0, import_react4.useEffect)(() => {
    if (!snapshot2.open || snapshot2.route.kind === "settings") return void 0;
    setFrameReady(false);
    setNavigationError("");
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data;
      const releaseDetailHistory = () => {
        if (!detailHistoryTokenRef.current) return;
        detailHistoryTokenRef.current = "";
        suppressHistoryPopRef.current = true;
        window.history.back();
      };
      if (message.source === "jira-workbench-local-ui" && message.type === "navigation-state") {
        if (message.view === "detail" && !detailHistoryTokenRef.current) {
          const token = `jira-workbench:${Date.now()}:${Math.random().toString(36).slice(2)}`;
          const currentState = window.history.state && typeof window.history.state === "object" ? window.history.state : {};
          detailHistoryTokenRef.current = token;
          window.history.pushState({ ...currentState, jiraWorkbenchDetail: token }, "", window.location.href);
        } else if (message.view === "board") {
          releaseDetailHistory();
        }
        return;
      }
      if (message.source === "jira-workbench-local-ui" && message.type === "close") {
        releaseDetailHistory();
        jiraWorkspaceStore.close();
        return;
      }
      if (message.source === "jira-workbench-local-ui" && message.type === "open-settings") {
        releaseDetailHistory();
        jiraWorkspaceStore.open({ kind: "settings" });
        return;
      }
      if (message.source !== "jira-workbench-dsh" || message.type !== "open-session") return;
      const sessionId = typeof message.sessionId === "string" ? message.sessionId.trim() : "";
      if (!sessionId) {
        setNavigationError(props.t("context.invalidSession"));
        return;
      }
      void props.openSession(sessionId).then(() => {
        setNavigationError("");
        releaseDetailHistory();
        jiraWorkspaceStore.close();
      }, (error) => {
        setNavigationError(error instanceof Error ? error.message : props.t("context.navigationFailed"));
      });
    };
    const onPopState = () => {
      if (suppressHistoryPopRef.current) {
        suppressHistoryPopRef.current = false;
        return;
      }
      if (!detailHistoryTokenRef.current) return;
      detailHistoryTokenRef.current = "";
      frameRef.current?.contentWindow?.postMessage({
        source: "jira-workbench-dsh-host",
        type: "navigate-back"
      }, window.location.origin);
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("popstate", onPopState);
      if (detailHistoryTokenRef.current) {
        detailHistoryTokenRef.current = "";
        window.history.back();
      }
      suppressHistoryPopRef.current = false;
    };
  }, [props, snapshot2.open, snapshot2.route]);
  (0, import_react4.useEffect)(() => {
    if (!snapshot2.open) return void 0;
    const onPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element) || rootRef.current?.contains(target)) return;
      if (target.closest("[data-jira-workbench-trigger]")) return;
      jiraWorkspaceStore.close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [snapshot2.open]);
  (0, import_react4.useEffect)(() => {
    if (!snapshot2.open) return void 0;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      jiraWorkspaceStore.close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [snapshot2.open]);
  if (!snapshot2.open) return null;
  if (snapshot2.route.kind === "settings") {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { ref: rootRef, className: `${JiraWorkspaceSurface_default.root} ${JiraWorkspaceSurface_default.settingsRoot}`, style: { left: sidebarInset }, "aria-label": props.t("card.title"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("header", { className: JiraWorkspaceSurface_default.settingsHeader, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: JiraWorkspaceSurface_default.eyebrow, children: "JIRA WORKBENCH" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h1", { children: props.t("card.title") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: JiraWorkspaceSurface_default.settingsActions, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { type: "button", className: JiraWorkspaceSurface_default.backButton, onClick: () => {
            jiraWorkspaceStore.open({ kind: "board" });
          }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: JiraWorkspaceSurface_default.backIcon, "aria-hidden": "true", children: "\u2190" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: "\u8FD4\u56DE\u4EFB\u52A1\u5DE5\u4F5C\u53F0" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: JiraWorkspaceSurface_default.iconButton, "aria-label": props.t("panel.close"), onClick: () => {
            jiraWorkspaceStore.close();
          }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.IconCloseOutline16, { size: 16 }) })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: JiraWorkspaceSurface_default.settingsBody, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(JiraConfigCard, { ...props, standalone: true }) })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { ref: rootRef, className: JiraWorkspaceSurface_default.root, style: { left: sidebarInset }, "aria-label": props.t("panel.title"), children: [
    !frameReady && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: JiraWorkspaceSurface_default.frameLoading, role: "status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: JiraWorkspaceSurface_default.spinner }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: "\u6B63\u5728\u6253\u5F00 Jira \u5DE5\u4F5C\u53F0\u2026" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: JiraWorkspaceSurface_default.loadingClose, onClick: () => {
        jiraWorkspaceStore.close();
      }, children: "\u5173\u95ED" })
    ] }),
    navigationError && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: JiraWorkspaceSurface_default.navigationError, role: "alert", children: navigationError }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "iframe",
      {
        ref: frameRef,
        className: JiraWorkspaceSurface_default.frame,
        src: frameUrl,
        title: props.t("panel.title"),
        onLoad: () => {
          setFrameReady(true);
        }
      },
      frameUrl
    )
  ] });
}

// src/client/jira-config-card-controller.ts
var import_client = require("@deepseek-ai/dsh-client-runtime/client");
var JIRA_WORKBENCH_NS = "jira-workbench";
var JIRA_WORKBENCH_TOKEN_REF = "JIRA_WORKBENCH_TOKEN";
var EMPTY_BOARD_SOURCE = { mode: "builtin", jql: "", filterIds: [] };
var EMPTY_BOARD_SOURCES = {
  projectKey: "",
  collaboratorFieldId: "",
  collaboratorJqlName: "",
  requirement: { ...EMPTY_BOARD_SOURCE },
  bug: { ...EMPTY_BOARD_SOURCE }
};
var EMPTY_TEMPLATE = { customized: false, content: "", skill: null };
var EMPTY_TEMPLATES = {
  requirement: { ...EMPTY_TEMPLATE },
  bug: { ...EMPTY_TEMPLATE }
};
var EMPTY_IMAGE_PROCESSING = {
  visionProvider: "",
  visionModel: "",
  localOcrEnabled: true
};
function cloneBoardSources(value) {
  return {
    ...value,
    requirement: { ...value.requirement, filterIds: [...value.requirement.filterIds] },
    bug: { ...value.bug, filterIds: [...value.bug.filterIds] }
  };
}
function clonePromptTemplates(value) {
  return {
    requirement: {
      ...value.requirement,
      skill: value.requirement.skill === null ? null : { ...value.requirement.skill }
    },
    bug: {
      ...value.bug,
      skill: value.bug.skill === null ? null : { ...value.bug.skill }
    }
  };
}
function cloneImageProcessing(value) {
  return { ...value };
}
function configurationFromPayload(payload) {
  const value = payload;
  const sources = value?.boardSources ?? EMPTY_BOARD_SOURCES;
  const templates = value?.promptTemplates ?? EMPTY_TEMPLATES;
  const imageProcessing = value?.imageProcessing ?? EMPTY_IMAGE_PROCESSING;
  return {
    configured: value?.configured === true,
    baseUrl: String(value?.baseUrl || ""),
    hasToken: value?.hasToken === true,
    boardSources: cloneBoardSources({
      ...EMPTY_BOARD_SOURCES,
      ...sources,
      requirement: { ...EMPTY_BOARD_SOURCE, ...sources.requirement },
      bug: { ...EMPTY_BOARD_SOURCE, ...sources.bug }
    }),
    promptTemplates: clonePromptTemplates({
      requirement: { ...EMPTY_TEMPLATE, ...templates.requirement },
      bug: { ...EMPTY_TEMPLATE, ...templates.bug }
    }),
    imageProcessing: cloneImageProcessing({ ...EMPTY_IMAGE_PROCESSING, ...imageProcessing })
  };
}
async function jsonRequest(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error?.message || `Jira workbench request failed (${response.status}).`);
  }
  return payload;
}
async function loadConfiguration() {
  const payload = await jsonRequest("/jira-workbench/config");
  return configurationFromPayload(payload.configuration);
}
async function commitJiraConfiguration(input) {
  const payload = await jsonRequest("/jira-workbench/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return configurationFromPayload(payload.configuration);
}
function isValidBaseUrl(text2) {
  const trimmed = text2.trim();
  if (trimmed === "") return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function currentBaseUrl(value) {
  return typeof value?.baseUrl === "string" ? value.baseUrl : "";
}
function sourcesInvalid(value) {
  return ["requirement", "bug"].some((kind) => {
    const source = value[kind];
    return source.mode === "custom" && source.jql.trim() === "" || source.mode === "filter" && source.filterIds.length === 0;
  });
}
function templatesInvalid(value) {
  return ["requirement", "bug"].some((kind) => value[kind].customized && value[kind].content.trim() === "");
}
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
var JiraConfigCardController = class {
  constructor(scope, api, commitConfiguration = commitJiraConfiguration) {
    this.token = { configured: false, writable: true };
    this.configuration = null;
    this.boardSourcesDraft = null;
    this.promptTemplatesDraft = null;
    this.imageProcessingDraft = null;
    this.baseUrlDraft = null;
    this.tokenDraft = "";
    this.projects = [];
    this.filters = [];
    this.skills = [];
    this.visionModels = [];
    this.loading = true;
    this.optionsLoading = false;
    this.optionsMessage = "";
    this.optionsRequestVersion = 0;
    this.filterRequestVersion = 0;
    this.saving = false;
    this.failed = false;
    this.failureMessage = "";
    this.scope = scope;
    this.api = api;
    this.commitConfiguration = commitConfiguration;
    this.store = (0, import_client.createSnapshotStore)(this.projection());
    scope.subscribe(() => {
      this.publish();
      if (this.configuration !== null) void this.syncSettingsBaseUrl(this.configuration.baseUrl);
    });
    void Promise.allSettled([this.readToken(), this.readConfiguration()]);
  }
  effectiveBoardSources() {
    return cloneBoardSources(this.boardSourcesDraft ?? this.configuration?.boardSources ?? EMPTY_BOARD_SOURCES);
  }
  effectivePromptTemplates() {
    return clonePromptTemplates(this.promptTemplatesDraft ?? this.configuration?.promptTemplates ?? EMPTY_TEMPLATES);
  }
  effectiveImageProcessing() {
    return cloneImageProcessing(
      this.imageProcessingDraft ?? this.configuration?.imageProcessing ?? EMPTY_IMAGE_PROCESSING
    );
  }
  projection() {
    const snapshot2 = this.scope.getSnapshot();
    const persistedBaseUrl = this.configuration !== null ? this.configuration.baseUrl : currentBaseUrl(snapshot2.value);
    const baseUrlText = this.baseUrlDraft ?? persistedBaseUrl;
    const boardSources = this.effectiveBoardSources();
    const promptTemplates = this.effectivePromptTemplates();
    const imageProcessing = this.effectiveImageProcessing();
    const preferencesDirty = this.configuration !== null && (!sameJson(boardSources, this.configuration.boardSources) || !sameJson(promptTemplates, this.configuration.promptTemplates) || !sameJson(imageProcessing, this.configuration.imageProcessing));
    const baseUrlInvalid = this.baseUrlDraft !== null && !isValidBaseUrl(this.baseUrlDraft);
    return {
      available: true,
      writable: this.configuration !== null,
      loading: this.loading,
      baseUrlText,
      tokenWritable: this.token.writable,
      tokenText: this.tokenDraft,
      tokenConfigured: this.token.configured || this.configuration?.hasToken === true,
      boardSources,
      promptTemplates,
      imageProcessing,
      projects: this.projects,
      filters: this.filters,
      skills: this.skills,
      visionModels: this.visionModels,
      optionsLoading: this.optionsLoading,
      optionsMessage: this.optionsMessage,
      dirty: this.baseUrlDraft !== null || this.tokenDraft.trim() !== "" || preferencesDirty,
      baseUrlInvalid,
      invalid: baseUrlInvalid || sourcesInvalid(boardSources) || templatesInvalid(promptTemplates),
      saving: this.saving,
      failed: this.failed,
      failureMessage: this.failureMessage
    };
  }
  async readConfiguration() {
    try {
      this.configuration = await loadConfiguration();
      this.loading = false;
      this.failed = false;
      this.failureMessage = "";
      this.publish();
      void this.syncSettingsBaseUrl(this.configuration.baseUrl);
      await this.loadOptions();
    } catch (error) {
      this.loading = false;
      this.failed = true;
      this.failureMessage = error instanceof Error ? error.message : String(error);
      this.publish();
    }
  }
  async readToken() {
    try {
      const response = await this.api.credentials.describe({ refs: [JIRA_WORKBENCH_TOKEN_REF] });
      if (!response.result.ok) return;
      const view = response.result.value.credentials[JIRA_WORKBENCH_TOKEN_REF];
      this.token = {
        configured: view?.configured ?? false,
        writable: view?.writable ?? true
      };
      this.publish();
    } catch {
    }
  }
  async fetchOptions(resource, params = {}) {
    const query = new URLSearchParams({ resource, ...params });
    return jsonRequest(`/jira-workbench/config-options?${query.toString()}`);
  }
  async loadFilters(projectKey) {
    const requestVersion = ++this.filterRequestVersion;
    const selectedProject = this.projects.find((project) => project.key === projectKey);
    try {
      const payload = await this.fetchOptions("filters", {
        projectKey,
        ...selectedProject?.id ? { projectId: selectedProject.id } : {},
        ...selectedProject?.name ? { projectName: selectedProject.name } : {}
      });
      if (requestVersion !== this.filterRequestVersion) return;
      this.filters = Array.isArray(payload.filters) ? payload.filters : [];
    } catch (error) {
      if (requestVersion !== this.filterRequestVersion) return;
      this.filters = [];
      this.optionsMessage = error instanceof Error ? error.message : String(error);
    }
  }
  async loadOptions() {
    if (!this.configuration?.configured) return;
    const requestVersion = ++this.optionsRequestVersion;
    this.optionsLoading = true;
    this.optionsMessage = "";
    this.publish();
    const [projectsResult, skillsResult, visionModelsResult] = await Promise.allSettled([
      this.fetchOptions("projects"),
      this.fetchOptions("skills"),
      this.fetchOptions("vision-models")
    ]);
    if (requestVersion !== this.optionsRequestVersion) return;
    if (projectsResult.status === "fulfilled") {
      this.projects = Array.isArray(projectsResult.value.projects) ? projectsResult.value.projects : [];
    } else {
      this.optionsMessage = projectsResult.reason instanceof Error ? projectsResult.reason.message : String(projectsResult.reason);
    }
    if (skillsResult.status === "fulfilled") {
      this.skills = Array.isArray(skillsResult.value.skills) ? skillsResult.value.skills : [];
      if (skillsResult.value.message) this.optionsMessage = skillsResult.value.message;
    } else if (!this.optionsMessage) {
      this.optionsMessage = skillsResult.reason instanceof Error ? skillsResult.reason.message : String(skillsResult.reason);
    }
    if (visionModelsResult.status === "fulfilled") {
      this.visionModels = Array.isArray(visionModelsResult.value.models) ? visionModelsResult.value.models : [];
      if (visionModelsResult.value.message && !this.optionsMessage) {
        this.optionsMessage = visionModelsResult.value.message;
      }
    } else if (!this.optionsMessage) {
      this.optionsMessage = visionModelsResult.reason instanceof Error ? visionModelsResult.reason.message : String(visionModelsResult.reason);
    }
    await this.loadFilters(this.effectiveBoardSources().projectKey);
    if (requestVersion !== this.optionsRequestVersion) return;
    this.optionsLoading = false;
    this.publish();
  }
  inject() {
    return {
      hooks: { jiraConfigCard: this.store },
      edit: (field, text2) => {
        this.edit(field, text2);
      },
      editProjectKey: (projectKey) => {
        this.editProjectKey(projectKey);
      },
      editBoardSource: (kind, patch) => {
        this.editBoardSource(kind, patch);
      },
      toggleFilter: (kind, filterId) => {
        this.toggleFilter(kind, filterId);
      },
      editTemplate: (kind, patch) => {
        this.editTemplate(kind, patch);
      },
      editImageProcessing: (patch) => {
        this.editImageProcessing(patch);
      },
      refreshOptions: () => {
        void this.loadOptions();
      },
      save: () => {
        void this.save();
      },
      discard: () => {
        this.discard();
      }
    };
  }
  edit(field, text2) {
    if (field === "baseUrl") this.baseUrlDraft = text2;
    else this.tokenDraft = text2;
    this.clearFailure();
    this.publish();
  }
  editProjectKey(projectKey) {
    const next = this.effectiveBoardSources();
    next.projectKey = projectKey.trim().toUpperCase();
    this.boardSourcesDraft = next;
    this.clearFailure();
    this.publish();
    void this.loadFilters(next.projectKey).then(() => {
      this.publish();
    });
  }
  editBoardSource(kind, patch) {
    const next = this.effectiveBoardSources();
    next[kind] = { ...next[kind], ...patch };
    if (patch.mode !== void 0) {
      if (patch.mode !== "custom") next[kind].jql = "";
      if (patch.mode !== "filter") next[kind].filterIds = [];
    }
    this.boardSourcesDraft = next;
    this.clearFailure();
    this.publish();
  }
  toggleFilter(kind, filterId) {
    const next = this.effectiveBoardSources();
    const selected = new Set(next[kind].filterIds);
    if (selected.has(filterId)) selected.delete(filterId);
    else selected.add(filterId);
    next[kind].filterIds = [...selected];
    this.boardSourcesDraft = next;
    this.clearFailure();
    this.publish();
  }
  editTemplate(kind, patch) {
    const next = this.effectivePromptTemplates();
    const patchedSkill = Object.prototype.hasOwnProperty.call(patch, "skill") ? patch.skill === null || patch.skill === void 0 ? null : { name: patch.skill.name, path: patch.skill.path, scope: patch.skill.scope } : next[kind].skill;
    next[kind] = {
      ...next[kind],
      ...patch,
      skill: patchedSkill
    };
    this.promptTemplatesDraft = next;
    this.clearFailure();
    this.publish();
  }
  editImageProcessing(patch) {
    const next = this.effectiveImageProcessing();
    this.imageProcessingDraft = { ...next, ...patch };
    this.clearFailure();
    this.publish();
  }
  discard() {
    this.baseUrlDraft = null;
    this.tokenDraft = "";
    this.boardSourcesDraft = null;
    this.promptTemplatesDraft = null;
    this.imageProcessingDraft = null;
    this.clearFailure();
    this.publish();
  }
  async save() {
    const state = this.projection();
    if (this.saving || state.invalid || !state.dirty) return;
    this.saving = true;
    this.clearFailure();
    this.publish();
    let landed = true;
    let failureMessage = "";
    const baseUrl = state.baseUrlText.trim();
    const token = this.tokenDraft.trim();
    if (token !== "") {
      try {
        const response = await this.api.credentials.set({ ref: JIRA_WORKBENCH_TOKEN_REF, value: token });
        landed = response.result.ok;
        if (!landed) failureMessage = "DSH \u672A\u63A5\u53D7 Jira Token\u3002";
      } catch (error) {
        landed = false;
        failureMessage = error instanceof Error ? error.message : String(error);
      }
    }
    if (landed) {
      try {
        this.configuration = await this.commitConfiguration({
          baseUrl,
          boardSources: state.boardSources,
          promptTemplates: state.promptTemplates,
          imageProcessing: state.imageProcessing
        });
      } catch (error) {
        landed = false;
        failureMessage = error instanceof Error ? error.message : String(error);
      }
    }
    if (landed) {
      this.baseUrlDraft = null;
      this.tokenDraft = "";
      this.boardSourcesDraft = null;
      this.promptTemplatesDraft = null;
      this.imageProcessingDraft = null;
      void this.syncSettingsBaseUrl(baseUrl);
      void this.loadOptions();
    }
    this.saving = false;
    this.failed = !landed;
    this.failureMessage = landed ? "" : failureMessage;
    await this.readToken();
    this.publish();
  }
  /** Best-effort compatibility mirror; it never decides whether Jira saved. */
  async syncSettingsBaseUrl(baseUrl) {
    const snapshot2 = this.scope.getSnapshot();
    if (snapshot2.status !== "ready" || !snapshot2.writable) return;
    if (baseUrl === currentBaseUrl(snapshot2.value)) return;
    try {
      if (baseUrl === "") await this.scope.unset("baseUrl");
      else await this.scope.set("baseUrl", baseUrl);
    } catch {
    }
  }
  clearFailure() {
    this.failed = false;
    this.failureMessage = "";
  }
  publish() {
    this.store.set(this.projection());
  }
};

// src/client/jira-session-context-api.ts
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function text(value, maximum = 2e4) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}
function errorDetail(value) {
  const source = record(value);
  if (source === null) return null;
  const message = text(source.message, 2e3);
  return message ? { code: text(source.code, 200), message } : null;
}
function issueDetail(value, issueKey) {
  const source = record(value) ?? {};
  const parent = record(source.parentIssue);
  return {
    key: text(source.key, 100) || issueKey,
    title: text(source.title, 1e3) || "\u5DF2\u5173\u8054 Jira \u4EFB\u52A1",
    type: text(source.type, 100),
    typeName: text(source.typeName, 100),
    status: text(source.status, 100),
    statusName: text(source.statusName, 100) || "\u72B6\u6001\u672A\u77E5",
    priority: text(source.priority, 100),
    assignee: text(source.assignee, 200),
    summary: text(source.summary),
    projectName: text(source.projectName, 300),
    url: text(source.url, 2e3),
    parentIssue: parent && text(parent.key, 100) ? { key: text(parent.key, 100), title: text(parent.title, 1e3) } : null
  };
}
function projectScopes(value) {
  const binding = record(value);
  const workspace = record(binding?.workspace);
  const source = Array.isArray(workspace?.projectScopes) ? workspace.projectScopes : [];
  return source.flatMap((candidate, index) => {
    const scope = record(candidate);
    const cwd = text(scope?.cwd, 2e3);
    if (!scope || !cwd) return [];
    return [{
      id: text(scope.id, 1e3) || `scope:${index + 1}`,
      cwd,
      projectLabel: text(scope.projectLabel, 500) || cwd
    }];
  });
}
async function readResponse(response) {
  const payload = record(await response.json().catch(() => null));
  if (payload === null) throw new Error("Jira \u4F1A\u8BDD\u5173\u8054\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6548\u6570\u636E\u3002");
  if (!response.ok || payload.ok !== true) {
    const detail = record(payload.error);
    throw new Error(text(detail?.message, 2e3) || `Jira \u4F1A\u8BDD\u5173\u8054\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09\u3002`);
  }
  return payload;
}
async function loadJiraSessionContext(sessionId) {
  const response = await fetch(`/jira-workbench/session-context?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  const payload = await readResponse(response);
  const revision = Number(payload.revision);
  if (!Number.isInteger(revision) || revision < 0) throw new Error("Jira \u4F1A\u8BDD\u5173\u8054\u7248\u672C\u65E0\u6548\u3002");
  if (payload.context === null) return { revision, context: null };
  const source = record(payload.context);
  const issueKey = text(source?.issueKey, 100).toUpperCase();
  const resolvedSessionId = text(source?.sessionId, 1e3);
  if (!source || !/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey) || !resolvedSessionId) {
    throw new Error("Jira \u4F1A\u8BDD\u5173\u8054\u5185\u5BB9\u4E0D\u5B8C\u6574\u3002");
  }
  return {
    revision,
    context: {
      sessionId: resolvedSessionId,
      issueKey,
      issue: issueDetail(source.issue, issueKey),
      issueError: errorDetail(source.issueError),
      projectScopes: projectScopes(source.workspace),
      workspaceError: errorDetail(source.workspaceError),
      conflictingIssueKeys: Array.isArray(source.conflictingIssueKeys) ? source.conflictingIssueKeys.map((value) => text(value, 100)).filter(Boolean) : []
    }
  };
}
async function clearJiraSessionContext(input) {
  const response = await fetch("/jira-workbench/session-context", {
    method: "DELETE",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  const payload = await readResponse(response);
  const revision = Number(payload.revision);
  if (!Number.isInteger(revision) || revision < 0) throw new Error("\u89E3\u9664\u5173\u8054\u540E\u7684\u7248\u672C\u56DE\u6267\u65E0\u6548\u3002");
  return revision;
}

// src/client/locales.ts
var NS = "jira-workbench";
var zh = {
  "card.title": "Jira \u5DE5\u4F5C\u53F0",
  "card.description": "\u914D\u7F6E Jira \u8FDE\u63A5\u3001\u4EFB\u52A1\u9762\u677F\u6765\u6E90\u3001\u9996\u6761\u6D88\u606F\u6A21\u677F\u3001DSH Skill \u4E0E\u56FE\u7247\u964D\u7EA7\u7B56\u7565\u3002",
  "card.pluginDescription": "\u914D\u7F6E Jira \u8FDE\u63A5\uFF1B\u4EFB\u52A1\u6765\u6E90\u3001\u6A21\u677F\u548C Skill \u5728\u5DE5\u4F5C\u53F0\u4E2D\u7BA1\u7406\u3002",
  "card.pluginSettingsHint": "\u4EFB\u52A1\u9762\u677F\u6765\u6E90\u3001\u6D88\u606F\u6A21\u677F\u4E0E Skill \u8BF7\u524D\u5F80 Jira \u5DE5\u4F5C\u53F0\u7684\u201C\u8BBE\u7F6E\u201D\u4E2D\u7BA1\u7406\u3002",
  "card.connectionSaveHint": "\u4EC5\u4FDD\u5B58 Jira \u5730\u5740\u548C Token\uFF0C\u4E0D\u4F1A\u6539\u53D8\u5DE5\u4F5C\u53F0\u7684\u5176\u4ED6\u914D\u7F6E\u3002",
  "card.settingsGroups": "Jira \u5DE5\u4F5C\u53F0\u8BBE\u7F6E\u5206\u7EC4",
  "card.connection": "Jira \u8FDE\u63A5",
  "card.connectionNavHint": "\u5730\u5740\u4E0E\u8EAB\u4EFD\u51ED\u8BC1",
  "card.connectionHint": "\u8FDE\u63A5\u51ED\u636E\u7531 DSH \u5B89\u5168\u4FDD\u5B58\uFF1BToken \u4E0D\u4F1A\u56DE\u663E\u5230\u6D4F\u89C8\u5668\u3002",
  "card.sources": "\u4EFB\u52A1\u9762\u677F\u6765\u6E90",
  "card.sourcesHint": "\u9700\u6C42\u548C Bug \u72EC\u7ACB\u9009\u62E9\u901A\u7528 JQL\u3001\u81EA\u5B9A\u4E49 JQL \u6216 Jira \u5DF2\u6709 Filter\u3002",
  "card.templates": "\u6D88\u606F\u6A21\u677F\u4E0E\u6280\u80FD",
  "card.templatesNav": "\u6D88\u606F\u6A21\u677F",
  "card.templatesNavHint": "\u9996\u6761\u5206\u6790\u6D88\u606F\u4E0E Skill",
  "card.templatesHint": "\u5206\u522B\u63A7\u5236\u9700\u6C42\u4E0E Bug \u65B0\u4F1A\u8BDD\u7684\u9996\u6761\u53EA\u8BFB\u5206\u6790\u6D88\u606F\u3002",
  "card.imagesNav": "\u56FE\u7247\u9644\u4EF6",
  "card.imagesNavHint": "\u539F\u56FE\u53D1\u9001\u4E0E OCR \u964D\u7EA7",
  "card.images": "\u56FE\u7247\u9644\u4EF6\u5904\u7406",
  "card.imagesHint": "\u5F53\u524D\u6A21\u578B\u652F\u6301\u56FE\u7247\u65F6\u76F4\u63A5\u53D1\u9001\u539F\u56FE\uFF1B\u6587\u672C\u6A21\u578B\u4F1A\u4F18\u5148\u8BA9\u65B0 Jira \u4F1A\u8BDD\u4F7F\u7528\u6240\u9009\u89C6\u89C9\u6A21\u578B\u5E76\u53D1\u9001\u539F\u56FE\uFF0C\u65E0\u6CD5\u5B89\u5168\u5207\u6362\u65F6\u518D\u964D\u7EA7\u89E3\u6790\u3002",
  "card.visionModel": "\u56FE\u7247\u5904\u7406\u6A21\u578B",
  "card.visionModelHint": "\u4EC5\u5217\u51FA DSH \u660E\u786E\u58F0\u660E\u652F\u6301\u56FE\u7247\u8F93\u5165\u7684\u6A21\u578B\u3002\u5305\u542B\u539F\u56FE\u7684\u65B0 Jira \u4F1A\u8BDD\u4F1A\u7EE7\u7EED\u4F7F\u7528\u8BE5\u6A21\u578B\uFF1B\u65E0\u6CD5\u5B89\u5168\u5207\u6362\u65F6\u518D\u7528\u5B83\u751F\u6210\u7ED3\u6784\u5316\u8BF4\u660E\u3002",
  "card.visionModelNone": "\u4E0D\u914D\u7F6E\u89C6\u89C9\u6A21\u578B",
  "card.visionModelSearch": "\u641C\u7D22\u89C6\u89C9\u6A21\u578B",
  "card.visionModelEmpty": "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u7684\u89C6\u89C9\u6A21\u578B",
  "card.visionModelUnavailable": "\u5DF2\u4FDD\u5B58\uFF0C\u5F53\u524D\u6A21\u578B\u76EE\u5F55\u672A\u8FD4\u56DE\u6B64\u9879",
  "card.visionModelChange": "\u66F4\u6539\u6A21\u578B",
  "card.visionModelChoose": "\u9009\u62E9\u6A21\u578B",
  "card.localOcr": "\u5141\u8BB8\u672C\u5730 OCR \u964D\u7EA7",
  "card.localOcrHint": "\u89C6\u89C9\u6A21\u578B\u4E0D\u53EF\u7528\u6216\u89E3\u6790\u5931\u8D25\u65F6\uFF0C\u5148\u5C1D\u8BD5 Windows OCR\uFF0C\u518D\u5C1D\u8BD5\u672C\u673A Tesseract\u3002",
  "card.imageStrategyNative": "\u5F53\u524D\u6A21\u578B\u652F\u6301\u56FE\u7247\uFF1A\u9996\u6761\u6D88\u606F\u643A\u5E26\u539F\u56FE\u3001\u6587\u4EF6\u540D\u548C Jira \u6765\u6E90\u3002",
  "card.imageStrategyVision": "\u5F53\u524D\u6A21\u578B\u4E0D\u652F\u6301\u56FE\u7247\uFF1A\u4F18\u5148\u8BA9\u65B0\u4F1A\u8BDD\u4F7F\u7528\u4E0A\u65B9\u6A21\u578B\u63A5\u6536\u539F\u56FE\uFF1B\u65E0\u6CD5\u5B89\u5168\u5207\u6362\u65F6\u751F\u6210\u7ED3\u6784\u5316\u8BF4\u660E\u3002",
  "card.imageStrategyOcr": "\u89C6\u89C9\u6A21\u578B\u672A\u4EA7\u51FA\u7ED3\u679C\uFF1A\u4F7F\u7528\u672C\u5730 OCR \u63D0\u53D6\u53EF\u89C1\u6587\u5B57\u3002",
  "card.imageStrategyUnparsed": "\u4ECD\u65E0\u6CD5\u89E3\u6790\uFF1A\u4F1A\u8BDD\u7167\u5E38\u521B\u5EFA\uFF0C\u5E76\u660E\u786E\u63D0\u793A\u56FE\u7247\u5C1A\u672A\u89E3\u6790\u3002",
  "card.advancedNav": "\u9AD8\u7EA7\u914D\u7F6E",
  "card.advancedNavHint": "\u4EFB\u52A1\u6765\u6E90\u4E0E\u9879\u76EE\u8303\u56F4",
  "card.loading": "\u6B63\u5728\u8BFB\u53D6 Jira \u5DE5\u4F5C\u53F0\u914D\u7F6E\u2026",
  "card.baseUrl": "Jira \u5730\u5740",
  "card.baseUrlHint": "\u4F8B\u5982 http://jira.example.com\uFF08\u4E0D\u542B\u672B\u5C3E\u659C\u6760\uFF09",
  "card.token": "Personal Access Token",
  "card.tokenHint": "\u7559\u7A7A\u8868\u793A\u4E0D\u4FEE\u6539\uFF1B\u4FDD\u5B58\u540E\u5199\u5165 DSH \u51ED\u636E\uFF08JIRA_WORKBENCH_TOKEN\uFF09\u3002",
  "card.tokenKeep": "\u5DF2\u914D\u7F6E\uFF1B\u8F93\u5165\u65B0 Token \u624D\u4F1A\u66FF\u6362",
  "card.tokenRequired": "\u8BF7\u8F93\u5165 Jira Personal Access Token",
  "card.tokenConfigured": "\u5DF2\u914D\u7F6E",
  "card.tokenUnconfigured": "\u672A\u914D\u7F6E",
  "card.save": "\u4FDD\u5B58",
  "card.discard": "\u653E\u5F03",
  "card.overridden": "\u5DF2\u8986\u76D6",
  "card.reset": "\u91CD\u7F6E",
  "card.invalidUrl": "Jira \u5730\u5740\u4E0D\u662F\u6709\u6548\u7684 HTTP(S) URL\u3002",
  "card.unsaved": "\u672A\u4FDD\u5B58",
  "card.saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002",
  "card.readOnly": "\u914D\u7F6E\u4E3A\u53EA\u8BFB\uFF0C\u65E0\u6CD5\u4FEE\u6539\u3002",
  "card.saving": "\u4FDD\u5B58\u4E2D\u2026",
  "card.projectKey": "Jira \u9879\u76EE",
  "card.projectPlaceholder": "\u9009\u62E9\u6216\u8F93\u5165\u9879\u76EE Key",
  "card.searchProject": "\u641C\u7D22\u9879\u76EE\u540D\u79F0\u6216 Key",
  "card.noProjects": "\u6CA1\u6709\u5339\u914D\u7684 Jira \u9879\u76EE",
  "card.refreshOptions": "\u5237\u65B0\u9009\u9879",
  "card.refreshing": "\u6B63\u5728\u5237\u65B0\u2026",
  "card.requirementSource": "\u9700\u6C42\u9762\u677F",
  "card.bugSource": "Bug \u9762\u677F",
  "card.requirementTemplate": "\u9700\u6C42\u5206\u6790\u6A21\u677F",
  "card.bugTemplate": "Bug \u8BCA\u65AD\u6A21\u677F",
  "card.skillRule": "\u7ED1\u5B9A Skill \u540E\uFF0CSkill \u4E2D\u7684\u5DE5\u5177\u3001\u6D41\u7A0B\u3001\u8BC1\u636E\u548C\u5B89\u5168\u7EA6\u675F\u4F18\u5148\uFF1B\u6A21\u677F\u4EC5\u8865\u5145 Skill \u672A\u8986\u76D6\u7684\u4E0A\u4E0B\u6587\u3002Skill \u5728\u76EE\u6807 DSH \u9879\u76EE\u4E0D\u53EF\u7528\u65F6\u4F1A\u81EA\u52A8\u4F7F\u7528\u6A21\u677F\u964D\u7EA7\u3002",
  "card.saveHint": "\u6240\u6709\u6539\u52A8\u4E00\u6B21\u4FDD\u5B58\uFF1B\u4E0D\u4F1A\u4FEE\u6539\u73B0\u6709\u4F1A\u8BDD\u6216 Jira \u5355\u636E\u3002",
  "panel.trigger": "Jira \u5DE5\u4F5C\u53F0",
  "panel.aria": "\u6253\u5F00 Jira \u5DE5\u4F5C\u53F0",
  "panel.title": "Jira \u5DE5\u4F5C\u53F0",
  "panel.close": "\u5173\u95ED",
  "panel.loadFailed": "\u5DE5\u4F5C\u53F0\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4\u670D\u52A1\u5DF2\u542F\u52A8\u3002",
  "context.title": "\u5F53\u524D Jira \u4EFB\u52A1",
  "context.aria": "\u67E5\u770B\u4F1A\u8BDD\u5173\u8054\u7684 Jira \u4EFB\u52A1\uFF1A{issueKey}",
  "context.refresh": "\u5237\u65B0",
  "context.refreshing": "\u5237\u65B0\u4E2D\u2026",
  "context.more": "\u66F4\u591A\u64CD\u4F5C",
  "context.collapse": "\u6536\u8D77 Jira \u6D6E\u7A97",
  "context.assignee": "\u8D1F\u8D23\u4EBA\uFF1A{assignee}",
  "context.parent": "\u7236\u4EFB\u52A1",
  "context.workspace": "\u9879\u76EE\u76EE\u5F55",
  "context.noWorkspace": "\u5C1A\u672A\u7ED1\u5B9A",
  "context.conflict": "\u8BE5\u4F1A\u8BDD\u8FD8\u5B58\u5728\u5F02\u5E38\u5173\u8054\uFF1A{issueKeys}\uFF0C\u8BF7\u5728\u4EFB\u52A1\u5DE5\u4F5C\u53F0\u4E2D\u6838\u5BF9\u3002",
  "context.openBoard": "\u67E5\u770B\u4EFB\u52A1\u8BE6\u60C5",
  "context.openSvn": "\u5BA1\u6838\u5E76\u63D0\u4EA4 SVN",
  "context.openJira": "\u5728 Jira \u6253\u5F00",
  "context.unlink": "\u89E3\u9664\u5173\u8054",
  "context.unlinkConfirm": "\u786E\u8BA4\u89E3\u9664 {issueKey} \u4E0E\u5F53\u524D\u4F1A\u8BDD\u7684\u5173\u8054\uFF1F",
  "context.cancel": "\u53D6\u6D88",
  "context.confirm": "\u786E\u8BA4\u89E3\u9664",
  "context.unlinking": "\u89E3\u9664\u4E2D\u2026",
  "context.svnTitle": "SVN \u5BA1\u6838\u4E0E\u63D0\u4EA4",
  "context.retry": "\u91CD\u8BD5\u8BFB\u53D6 Jira \u4F1A\u8BDD\u5173\u8054",
  "context.errorShort": "Jira \u5173\u8054\u5F02\u5E38",
  "context.loadFailed": "\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D\u4F1A\u8BDD\u7684 Jira \u5173\u8054\u3002",
  "context.unlinkFailed": "\u89E3\u9664 Jira \u4F1A\u8BDD\u5173\u8054\u5931\u8D25\u3002",
  "context.invalidSession": "\u5173\u8054\u4E2D\u7684 DSH \u4F1A\u8BDD ID \u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u5173\u8054\u3002",
  "context.navigationFailed": "\u65E0\u6CD5\u6253\u5F00\u5173\u8054\u7684 DSH \u4F1A\u8BDD\u3002"
};
var en = {
  "card.title": "Jira Workbench",
  "card.description": "Configure Jira access, board sources, first-message templates, DSH Skills, and image fallbacks.",
  "card.pluginDescription": "Configure Jira access; manage sources, templates, and Skills in the workbench.",
  "card.pluginSettingsHint": "Manage task board sources, message templates, and Skills in Jira Workbench settings.",
  "card.connectionSaveHint": "Only the Jira URL and token are saved; other workbench settings are unchanged.",
  "card.settingsGroups": "Jira workbench settings groups",
  "card.connection": "Jira connection",
  "card.connectionNavHint": "URL and credentials",
  "card.connectionHint": "DSH stores credentials securely; the token is never echoed to the browser.",
  "card.sources": "Task board sources",
  "card.sourcesHint": "Configure requirements and bugs with built-in JQL, custom JQL, or existing Jira Filters.",
  "card.templates": "Templates and Skills",
  "card.templatesNav": "Message templates",
  "card.templatesNavHint": "First analysis message and Skills",
  "card.templatesHint": "Control the first read-only analysis message for requirement and bug sessions.",
  "card.imagesNav": "Image attachments",
  "card.imagesNavHint": "Native images and OCR fallback",
  "card.images": "Image attachment handling",
  "card.imagesHint": "Send originals when the current model supports images. For a text model, prefer the selected vision model for the new Jira session; fall back to parsing only when a safe switch is unavailable.",
  "card.visionModel": "Image processing model",
  "card.visionModelHint": "Only DSH models that explicitly accept images are listed. A new Jira session containing originals keeps this model; it also provides structured parsing when a safe switch is unavailable.",
  "card.visionModelNone": "No vision model",
  "card.visionModelSearch": "Search vision models",
  "card.visionModelEmpty": "No image-capable model is currently available",
  "card.visionModelUnavailable": "Saved; not currently returned by the model catalog",
  "card.visionModelChange": "Change model",
  "card.visionModelChoose": "Choose model",
  "card.localOcr": "Allow local OCR fallback",
  "card.localOcrHint": "When vision analysis is unavailable, try Windows OCR and then the local Tesseract executable.",
  "card.imageStrategyNative": "Image-capable current model: send the original with its filename and Jira source.",
  "card.imageStrategyVision": "Text-only current model: prefer the configured model for native images; produce a structured description only when a safe switch is unavailable.",
  "card.imageStrategyOcr": "No vision result: extract visible text with local OCR.",
  "card.imageStrategyUnparsed": "Still unavailable: create the session and clearly mark the image as unparsed.",
  "card.advancedNav": "Advanced",
  "card.advancedNavHint": "Task sources and project scope",
  "card.loading": "Loading Jira workbench settings\u2026",
  "card.baseUrl": "Jira URL",
  "card.baseUrlHint": "e.g. http://jira.example.com (no trailing slash)",
  "card.token": "Personal Access Token",
  "card.tokenHint": "Leave blank to keep the current token; saved into the DSH credential (JIRA_WORKBENCH_TOKEN).",
  "card.tokenKeep": "Configured; enter a new token to replace it",
  "card.tokenRequired": "Enter a Jira Personal Access Token",
  "card.tokenConfigured": "Configured",
  "card.tokenUnconfigured": "Not configured",
  "card.save": "Save",
  "card.discard": "Discard",
  "card.overridden": "Overridden",
  "card.reset": "Reset",
  "card.invalidUrl": "The Jira URL is not a valid HTTP(S) URL.",
  "card.unsaved": "Unsaved",
  "card.saveFailed": "Save failed, please retry.",
  "card.readOnly": "Read-only configuration.",
  "card.saving": "Saving\u2026",
  "card.projectKey": "Jira project",
  "card.projectPlaceholder": "Select or enter a project key",
  "card.searchProject": "Search project name or key",
  "card.noProjects": "No matching Jira projects",
  "card.refreshOptions": "Refresh options",
  "card.refreshing": "Refreshing\u2026",
  "card.requirementSource": "Requirement board",
  "card.bugSource": "Bug board",
  "card.requirementTemplate": "Requirement analysis template",
  "card.bugTemplate": "Bug diagnosis template",
  "card.skillRule": "A bound Skill takes precedence for tools, workflow, evidence, and safety constraints. The template only fills gaps. If the Skill is unavailable in the target DSH project, the template is used as the fallback.",
  "card.saveHint": "All changes are saved together; existing sessions and Jira issues are not modified.",
  "panel.trigger": "Jira Workbench",
  "panel.aria": "Open the Jira workbench",
  "panel.title": "Jira Workbench",
  "panel.close": "Close",
  "panel.loadFailed": "Failed to load the workbench; confirm the service is running.",
  "context.title": "Current Jira issue",
  "context.aria": "View the Jira issue linked to this session: {issueKey}",
  "context.refresh": "Refresh",
  "context.refreshing": "Refreshing\u2026",
  "context.more": "More actions",
  "context.collapse": "Collapse Jira context",
  "context.assignee": "Assignee: {assignee}",
  "context.parent": "Parent",
  "context.workspace": "Projects",
  "context.noWorkspace": "Not bound",
  "context.conflict": "This session also has unexpected bindings: {issueKeys}. Review them in the workbench.",
  "context.openBoard": "View issue details",
  "context.openSvn": "Review and commit SVN",
  "context.openJira": "Open in Jira",
  "context.unlink": "Unlink",
  "context.unlinkConfirm": "Unlink {issueKey} from this session?",
  "context.cancel": "Cancel",
  "context.confirm": "Unlink",
  "context.unlinking": "Unlinking\u2026",
  "context.svnTitle": "SVN review and commit",
  "context.retry": "Retry reading the Jira session binding",
  "context.errorShort": "Jira binding error",
  "context.loadFailed": "Failed to read this session\u2019s Jira binding.",
  "context.unlinkFailed": "Failed to unlink the Jira issue.",
  "context.invalidSession": "The linked DSH session id is invalid. Bind it again.",
  "context.navigationFailed": "Failed to open the linked DSH session."
};

// src/client/index.ts
var inject = ["slots", "locale", "connection", "settingsScope", "sessions"];
function apply(ctx) {
  const { api } = ctx.get("connection");
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-jira-workbench: dictionaries");
  const card = new JiraConfigCardController(
    ctx.settingsScope.bind({ namespace: JIRA_WORKBENCH_NS }),
    api
  );
  const rootSlots = ctx.slots;
  const openSessionWhenVisible = (sessionId) => {
    const id = sessionId;
    const visible = () => ctx.sessions.list.getSnapshot().byId[id] !== void 0;
    if (visible()) {
      ctx.sessions.open(id);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {
      };
      const timer = window.setTimeout(() => {
        unsubscribe();
        reject(new Error("DSH \u4F1A\u8BDD\u5DF2\u7ECF\u521B\u5EFA\uFF0C\u4F46\u4F1A\u8BDD\u5217\u8868\u5C1A\u672A\u540C\u6B65\uFF0C\u8BF7\u7A0D\u540E\u4ECE\u4FA7\u8FB9\u680F\u6253\u5F00\u3002"));
      }, 5e3);
      unsubscribe = ctx.sessions.list.subscribe(() => {
        if (!visible()) return;
        window.clearTimeout(timer);
        unsubscribe();
        ctx.sessions.open(id);
        resolve();
      });
    });
  };
  const settingsPluginIdentity = { id: JIRA_WORKBENCH_NS };
  ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
    name: "settings.plugin.item",
    key: JIRA_WORKBENCH_NS,
    ...settingsPluginIdentity,
    locale: NS,
    inject: () => card.inject()
  }, JiraConfigCard));
  rootSlots.inject("shell.overlay", () => rootSlots.register({
    name: "shell.overlay",
    id: "jira-workbench-surface",
    order: 0,
    locale: NS,
    inject: () => ({
      ...card.inject(),
      openSession: openSessionWhenVisible
    })
  }, JiraWorkspaceSurface));
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "jira-workbench",
    locale: NS
  }, JiraPanel));
  ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
    name: "conversation.session.header.utilities",
    id: "jira-workbench-session-context",
    order: -10,
    locale: NS,
    inject: () => ({
      loadContext: loadJiraSessionContext,
      clearContext: clearJiraSessionContext
    })
  }, JiraSessionContext));
}
return module.exports; } });
