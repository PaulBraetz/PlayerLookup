const ORGS_BLACKLIST_SHEET_NAME = "Orgs Blacklist";
const ORG_BLACKLIST_NAME_SID_COLUMNS = "A:B";

const PLAYERS_BLACKLIST_SHEET_NAME = "Players Blacklist";
const PLAYER_BLACKLIST_NAME_SPECTRUM_COLUMN = "A:B";

const REDACTED_NAME = "[REDACTED]";

function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu("[KRT] Utilities")
      .addItem('Player Lookup', 'showPlayerLookupSidebar')
      .addToUi();
}

function showPlayerLookupSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('sidebar')
      .setTitle('Player Lookup');

  SpreadsheetApp.getUi() // Or DocumentApp or SlidesApp or FormApp.
      .showSidebar(html);
}

function fetchPlayer(name){
  const body = getResponseContent(getPlayerUrl(name));

  if(body != ""){
    const name = getName(body);
    const orgs = getOrgs(name);
    return buildPlayerJson(name, orgs);
  }
  return buildPlayerJson("", []);
}

function getName(body){
  const searchString = "handle name ";
  const searchRegex = new RegExp(searchString + ".*\s", "gi");
  const name = body.match(searchRegex)[0].split(" ")[2];
  return name;
}
function getOrgs(name){
  var orgsBody = getUnsanitizedResponseContent(getOrgsUrl(name));

  var visible = getVisible(orgsBody);
  var redacted = getRedacted(orgsBody);

  return  visible.concat(redacted);
}

function getVisible(orgsBody){
  orgsBody = sanitizeDocument(orgsBody);
  const membersString = "members ";
  const rankString = " Organization rank";
  var memberIndex = 0;
  var rankIndex = 0;
  function setIndices(){
    memberIndex = orgsBody.indexOf(membersString);
    rankIndex = orgsBody.indexOf(rankString);
  }

  const orgs = [];

  setIndices();
  while(memberIndex != -1){
    const orgRaw = orgsBody.slice(memberIndex, rankIndex);
    const org = orgRaw.slice(membersString.length, orgRaw.length).split(" Spectrum Identification (SID) ");
    orgs.push(buildOrgJson(org[0], org[1]));

    orgsBody = orgsBody.slice(rankIndex + rankString.length);
    setIndices();
  }

  return orgs;
}

function getRedacted(orgsBody){
  const retVal = [];

  const matches = orgsBody.match(/visibility\-R/g);
  if(matches != null){
    const amount = matches.length;
    for(var i = 0; i < amount; i++){
      retVal.push(buildOrgJson(REDACTED_NAME, ""));
    }
  }
  return retVal;
}

function buildPlayerJson(name, orgJsons){
  const retVal = buildSimplePlayerJson(name, orgJsons);
  retVal.blacklisted = isBlacklistedPlayer(retVal);
  return retVal;
}
function buildSimplePlayerJson(name, orgJsons){
  const retVal = buildSimplePlayerNoOrgsJson(name);
  retVal.orgs = orgJsons;
  return retVal;
}
function buildSimplePlayerNoOrgsJson(name){
  return {
    name: name
  };
}

function buildOrgJson(name, sid){
  const retVal = buildSimpleOrgJson(name, sid);
  retVal.blacklisted = isBlacklistedOrg(retVal);
  return retVal;
}
function buildSimpleOrgJson(name, sid){
  return {
    name: name,
    sid: sid
  };
}

//Network Operations

function getPlayerUrl(name){
  return "https://www.robertsspaceindustries.com/citizens/" + name;
}
function getOrgsUrl(playerName){
  return getPlayerUrl(playerName) + "/organizations";
}
function getSpectrumUrl(actualName){
  return "https://www.robertsspaceindustries.com/spectrum/community/SC/search?member=" + actualName + "&page=1&q=&range=all&role&scopes=op%2Creply%2Cchat&sort=latest&visibility=nonerased";
}
function getOrgUrl(sid){
  return "https://www.robertsspaceindustries.com/orgs/" + sid;
}

function getResponseContent(url, options){
  return sanitizeDocument(getUnsanitizedResponseContent(url, options));
}
function getUnsanitizedResponseContent(url, options){
  if(options == undefined){
    options = {muteHttpExceptions: true};
  }
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if(code == 200){
    return response.getContentText();
  }
  return "";
}
function sanitizeDocument(document){
  document = dropTagsAndContent(document, ["script","style"]);
  document = document.replace(/<(.|\n)*?>/g, '');
  while(document.indexOf("  ") != -1){
    document = document.replace(/\s\s/g, " ");
  }
  document = document.replace(/\n/g, "");
  document = document.replace(/&nbsp;/g, " ");
  return document;
}

function dropTagsAndContent(aDocument, tagNames){
  var retVal = aDocument;
  for(var i = 0; i < tagNames.length; i++){
    const tagName = tagNames[i];
    var sliceStart = 0;

    while(sliceStart != -1){
      const beginTag = "<" + tagName;
      sliceStart = retVal.indexOf(beginTag);

      const endTag = "</" + tagName + ">";
      const sliceEnd = retVal.indexOf(endTag) + endTag.length;

      if(sliceStart > sliceEnd){
        break;
      }

      const tagAndContent = retVal.slice(sliceStart, sliceEnd);

      retVal = retVal.replace(tagAndContent, "<!--tag removed-->");
    }
  }
  return retVal;
}

//Sheet Operations --------------------------------------------

function getHyperlinkCellValue(link, text){
  return "=HYPERLINK(\"" + link + "\", \"" + text + "\")";
}

//Blacklist operations --------------------------------------------

function getBlacklistSheet(name){
  //edit using https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app?hl=en#openbyurlurl change blacklist source spreadsheet
  const spreadsheet = SpreadsheetApp.getActive();
  var blacklistSheet = spreadsheet.getSheetByName(name);
  if(blacklistSheet == null){
    spreadsheet.insertSheet(name);
    blacklistSheet = spreadsheet.getSheetByName(name);
  }
  return blacklistSheet;
}

//Orgs Blacklist Operations --------------------------------------------

function getOrgsBlacklistSheet(){
  return getBlacklistSheet(ORGS_BLACKLIST_SHEET_NAME);
}
function getOrgsBlacklistSheetRange(){
  return getOrgsBlacklistSheet().getRange(ORG_BLACKLIST_NAME_SID_COLUMNS);
}
function getOrgsBlacklistSheetValues(){
  return getOrgsBlacklistSheetRange().getValues();
}

//Orgs blacklisting --------------------------------------------

function appendOrgToBlacklist(org){  
  const blacklistSheet = getOrgsBlacklistSheet();
  const values = getOrgsBlacklistSheetValues();
  //append only once
  if(values.every(v => v[1] != org.sid) || (org.name == REDACTED_NAME && values.every(v => v[0] != org.name))){
    const url = getOrgUrl(org.sid);
    const hyperlink = getHyperlinkCellValue(url, org.name);

    blacklistSheet.appendRow([hyperlink, org.sid]);
  }
}

function removeOrgFromBlacklist(org){
  const blacklistSheet = getOrgsBlacklistSheet();
  const values = getOrgsBlacklistSheetValues();
  //removes all matches
  for(var i = values.length - 1; i >= 0; i--)
    if(values[0,i][0] == org.name && values[0,i][1] == org.sid)
      blacklistSheet.deleteRow(i+1);
}

function getBlacklistedOrgs(){
  //return only populated rows as json
  return getOrgsBlacklistSheetValues()
    .filter(value => value[0] != "")
    .map(value => buildSimpleOrgJson(value[0], value[1]));
}

function isBlacklistedOrg(org){
  return getBlacklistedOrgs().some(blacklistedOrg => blacklistedOrg.name == org.name && blacklistedOrg.sid == org.sid);
}

//Players Blacklist Operations --------------------------------------------

function getPlayersBlacklistSheet(){
  return getBlacklistSheet(PLAYERS_BLACKLIST_SHEET_NAME);
}
function getPlayersBlacklistSheetRange(){
  return getPlayersBlacklistSheet().getRange(PLAYER_BLACKLIST_NAME_SPECTRUM_COLUMN);
}
function getPlayersBlacklistSheetValues(){
  return getPlayersBlacklistSheetRange().getValues();
}

//Players blacklisting -------------------------------------------- 

function appendPlayerToBlacklist(player){  
  const blacklistSheet = getPlayersBlacklistSheet();
  const values = getPlayersBlacklistSheetValues();
  //append only once
  if(values.every(v => v[0] != player.name)){
    const playerUrl = getPlayerUrl(player.name);
    const nameHyperlink = getHyperlinkCellValue(playerUrl, player.name);

    const spectrumUrl = getSpectrumUrl(player.name);
    const spectrumHyperlink = getHyperlinkCellValue(spectrumUrl, "Spectrum Posts");

    blacklistSheet.appendRow([nameHyperlink, spectrumHyperlink]);
  }
}

function removePlayerFromBlacklist(player){
  const blacklistSheet = getPlayersBlacklistSheet();
  const values = getPlayersBlacklistSheetValues();
  //removes all matches
  for(var i = values.length - 1; i >= 0; i--)
    if(values[0,i][0] == player.name)
      blacklistSheet.deleteRow(i+1);
}

function getBlacklistedPlayers(){
  //return only populated rows as json
  return getPlayersBlacklistSheetValues()
    .filter(value => value[0] != "")
    .map(value => buildSimplePlayerNoOrgsJson(value[0]));
}

function isBlacklistedPlayer(player){
  const notEmpty = player.name != "";
  const blacklistedPlayers = getBlacklistedPlayers();
  const isBlacklisted = blacklistedPlayers.some(blacklistedPlayer => blacklistedPlayer.name == player.name);
  return notEmpty && isBlacklisted;
}



function test(){  
  /*
    const sleep = fetchPlayer("sleepWellPupper");
  const krt = sleep.orgs[0];

  appendPlayerToBlacklist(sleep);
  appendOrgToBlacklist(krt);
  Logger.log(fetchPlayer("sleepWellPupper"))
  
  removePlayerFromBlacklist(sleep);
  removeOrgFromBlacklist(krt);
  Logger.log(fetchPlayer("sleepWellPupper"))

  Logger.log(getHyperlinkCellValue(getPlayerUrl(sleep.name), sleep.name))
  Logger.log(getHyperlinkCellValue(getOrgsUrl(sleep.name), sleep.name))
  Logger.log(getHyperlinkCellValue(getOrgUrl(krt.sid), krt.name))

  apiTest(sleep.name,1 );
  */  

  Logger.log(fetchPlayer("virgjl"));
}


























