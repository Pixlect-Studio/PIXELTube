from pathlib import Path
import re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
def browser_source(path):
    s=path.read_text()
    s=re.sub(r'^import .*?;\s*','',s,flags=re.M|re.S)
    s=re.sub(r'^export\s+','',s,flags=re.M)
    return s
helpers=browser_source(root/'js/helpers.js')
sec=browser_source(root/'js/sec.js')
# The harness uses the actual sec.js view renderers and actual delegated search/report handlers.
setup=r'''
const now = Date.now();
const channels = {
 ch1:{id:'ch1',name:'Pixel Racing',handle:'@pixelracing',ownerUid:'owner-1',ownerUsername:'creator1',publishingMode:'REVIEW',verified:true,createdAt:now-10000,moderationInbox:{
  adminThread:{id:'adminThread',subject:'Policy warning',type:'warning',createdAt:now-3000,updatedAt:now-1000,closed:false,messages:{m1:{senderRole:'admin',senderName:'PIXELTube Admin',text:'Please review the policy',ts:now-3000}}},
  userThread:{id:'userThread',subject:'User-created thread',type:'user-message',createdAt:now-2000,updatedAt:now-2000,closed:false,messages:{m2:{senderRole:'user',senderName:'creator1',text:'Should not show',ts:now-2000}}}
 }},
 ch2:{id:'ch2',name:'Space Lab',handle:'@spacelab',ownerUid:'owner-2',publishingMode:'FREE',createdAt:now-5000}
};
const videos={
 v1:{id:'v1',title:'Hover Racer Gameplay',channelId:'ch1',kind:'long',views:12,likes:1,dislikes:0,createdAt:now-1000,createdBy:'owner-1',reviewStatus:'pending',reviewSubmittedAt:now-800,moderationTags:['needs-review'],desc:'demo'},
 v2:{id:'v2',title:'Black Hole Facts',channelId:'ch2',kind:'mini',views:8,likes:0,dislikes:0,createdAt:now-2000,reviewStatus:'ignored',moderationTags:[]}
};
const reports={r1:{id:'r1',videoId:'v1',reporterUid:'reporter-uid',reporterUsername:'reporter-one',category:'unsafe',note:'Needs a closer look',ts:now-500,status:'pending'},r2:{id:'r2',videoId:'v2',reporterUid:'reporter-uid-2',reporterUsername:'reporter-two',category:'spam',note:'Already reviewed',ts:now-700,status:'resolved',moderationNote:'Reviewed'}};
const state={channels,videos,reports,audit:{},subs:{},mode:'local'};
const ctx={PIXLECT:{user:{uid:'admin-uid',username:'admin14'}},state,isAdmin:()=>true,emptyState:(_i,t,d)=>`<div>${t} ${d||''}</div>`,chanOf:id=>channels[videos[id]?.channelId]||null,subsOf:()=>0,videosSorted:()=>Object.values(videos),localDB:{channels,videos,reports,audit:state.audit},persistLocal(){},applyData(){},toast(){}};
window.testCtx=ctx; window.testViews={viewAdmin,viewModerationInbox};
document.getElementById('test-root').innerHTML=viewAdmin(ctx,'search'); window.testReady=true;
'''
html='<!doctype html><html><head><meta charset="utf-8"></head><body><div id="test-root"></div><script>'+helpers+'\n'+sec+'\n'+setup+'</script></body></html>'
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page()
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_content(html,wait_until='load')
    page.wait_for_function('window.testReady === true')
    assert page.locator('[data-admin-search-item]').count()==4
    assert page.locator('[data-admin-search-item]:visible').count()==0
    page.locator('[data-admin-search-kind]').select_option('channel')
    page.locator('[data-admin-search-input]').fill('Pixel Racing')
    assert page.locator('[data-search-kind="channel"]:visible').count()==1
    assert page.locator('[data-search-kind="video"]:visible').count()==0
    assert page.get_by_role('link',name='Open Channel Admin Panel').get_attribute('href')=='#/admin/channel/ch1'
    page.locator('[data-admin-search-clear]').click()
    assert page.locator('[data-admin-search-item]:visible').count()==0
    page.evaluate("document.getElementById('test-root').innerHTML = window.testViews.viewAdmin(window.testCtx,'channel','ch1')")
    assert page.get_by_text('QVids publishing control').count()==1
    assert page.get_by_role('button',name='Turn QVids OFF').count()==1
    for name in ['Send warning','Send admin inbox message','Revoke verification','Suspend channel','Delete channel…']:
        assert page.get_by_role('button',name=name).count()==1, name
    for token in ['Inspect / reports','admin-video-toggle-restrict','admin-flag-video','admin-rename-video','admin-warn-video','admin-delete-standalone']:
        assert token in page.locator('#test-root').inner_html(), token
    page.evaluate("document.getElementById('test-root').innerHTML = window.testViews.viewAdmin(window.testCtx,'qvids')")
    assert page.get_by_text('QVids Approval Queue').count()==1
    assert page.get_by_role('button',name='Approve',exact=True).count()==2
    assert page.get_by_role('button',name='Ignore',exact=True).count()==2
    assert page.get_by_role('button',name='Disapprove',exact=True).count()==2
    page.evaluate("document.getElementById('test-root').innerHTML = window.testViews.viewAdmin(window.testCtx,'')")
    assert page.locator('[data-report-filter-status]').count()==1
    assert page.locator('details.admin-report-details').count()==2
    assert page.get_by_role('button',name='Resolve').count()==1
    page.locator('details.admin-report-details summary').first.click()
    assert page.locator('details.admin-report-details[open]').count()==1
    page.locator('[data-report-filter-search]').fill('reporter-one')
    assert page.locator('[data-admin-report-item]:visible').count()==1
    page.locator('[data-report-filter-search]').fill('no-match')
    assert page.locator('[data-admin-report-item]:visible').count()==0
    page.locator('[data-report-filter-search]').fill('')
    page.locator('[data-report-filter-category]').select_option('unsafe')
    assert page.locator('[data-admin-report-item]:visible').count()==1
    page.locator('[data-report-filter-category]').select_option('spam')
    assert page.locator('[data-admin-report-item]:visible').count()==1
    page.locator('[data-report-filter-category]').select_option('')
    page.locator('[data-report-filter-status]').select_option('pending')
    assert page.locator('[data-admin-report-item]:visible').count()==1
    page.locator('[data-report-filter-status]').select_option('resolved')
    assert page.locator('[data-admin-report-item]:visible').count()==1
    page.locator('[data-report-filter-status]').select_option('')
    page.locator('[data-report-filter-creator]').select_option('ch1')
    assert page.locator('[data-admin-report-item]:visible').count()==1
    page.locator('[data-report-filter-creator]').select_option('ch2')
    assert page.locator('[data-admin-report-item]:visible').count()==1
    page.locator('[data-report-filter-creator]').select_option('')
    today=page.evaluate('new Date().toISOString().slice(0,10)')
    page.locator('[data-report-filter-from]').fill(today)
    assert page.locator('[data-admin-report-item]:visible').count()==2, {'from':today,'rows':page.locator('[data-admin-report-item]').evaluate_all('(els)=>els.map(e=>({date:e.dataset.reportDate,hidden:e.hidden}))')}
    page.locator('[data-report-filter-to]').fill(today)
    assert page.locator('[data-admin-report-item]:visible').count()==2
    page.locator('[data-report-filter-clear]').click()
    assert page.locator('[data-admin-report-item]:visible').count()==2
    page.evaluate("document.getElementById('test-root').innerHTML = window.testViews.viewAdmin(window.testCtx,'video','v1')")
    for token in ['Video inspection','admin-video-toggle-restrict','admin-rename-video','admin-warn-video','Reports for this video']:
        assert token in page.locator('#test-root').inner_html(), token
    page.evaluate("document.getElementById('test-root').innerHTML = window.testViews.viewModerationInbox({...window.testCtx, PIXLECT:{user:{uid:'owner-1',username:'creator1'}}})")
    inbox=page.locator('#test-root').inner_text()
    assert 'Messages from Admin' in inbox
    assert 'Please review the policy' in inbox
    assert 'Should not show' not in inbox
    assert page.get_by_role('button',name='Reply to admin').count()==1
    assert page.get_by_text('Start a new conversation').count()==0
    assert page.get_by_text('Send new message').count()==0
    page.evaluate("document.getElementById('test-root').innerHTML = window.testViews.viewAdmin({...window.testCtx,isAdmin:()=>false},'dashboard')")
    assert 'Admins only' in page.locator('#test-root').inner_text()
    assert not errors, errors
    browser.close()
print('PASS: Chromium DOM smoke — search/hide/clear and channel-only filter, channel admin/QVids controls, per-video moderation buttons, QVids decisions, report search/status/reason/creator/date filters and expandable details, video inspector, admin-message-only inbox/reply UI, and non-admin gate.')
