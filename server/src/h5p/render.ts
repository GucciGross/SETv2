import type { IEditorModel, IPlayerModel } from '@lumieducation/h5p-server';
import { escapeHtml, safeJson, type Grant } from './domain.js';

function head(model: IEditorModel | IPlayerModel, title: string): string {
  return `<!doctype html><html lang="en" data-set-h5p="true"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title>
  <script>window.H5PIntegration=${safeJson(model.integration)};</script>
  ${model.styles.map((s) => `<link rel="stylesheet" href="${escapeHtml(s)}">`).join('\n')}
  ${model.scripts.map((s) => `<script src="${escapeHtml(s)}"></script>`).join('\n')}
  <style>html,body{margin:0;background:#fff;color:#171717;font:14px system-ui,sans-serif}*{box-sizing:border-box}body{padding:12px}.studio-bar{position:sticky;bottom:0;z-index:20;background:#fff;border-top:1px solid #ddd;padding:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.studio-bar button{background:#171717;color:white;border:0;border-radius:6px;padding:10px 18px;font:inherit;cursor:pointer}.studio-bar button:disabled{opacity:.5}.studio-error{color:#a21c1c}button:focus-visible,a:focus-visible{outline:3px solid #2f6fed;outline-offset:2px}.h5p-content{max-width:100%}</style></head>`;
}
function bridge(grant: Grant): string {
  return `var studioGrant=${safeJson({ nonce: grant.nonce, parentOrigin: grant.parentOrigin })};
    function notify(type,extra){parent.postMessage(Object.assign({source:'set-h5p',type:type,nonce:studioGrant.nonce},extra||{}),studioGrant.parentOrigin);}
    window.addEventListener('error',function(){notify('error',{message:'An H5P script could not load. Reopen the activity or check its installed libraries.'});});
    window.addEventListener('unhandledrejection',function(){notify('error',{message:'H5P could not complete loading. Check the server connection and installed libraries.'});});`;
}

/** Native H5PEditor, not a replacement form or JSON textarea. Kept inside its own document. */
export function editorDocument(model: IEditorModel, grant: Grant, baseUrl: string): string {
  return `${head(model, 'H5P Studio')}<body><form id="studio-form"><div id="native-editor" class="h5p-editor"></div>
    <div class="studio-bar"><button id="studio-save" type="submit">Save draft</button><span id="studio-status" role="status" aria-live="polite">Choose a content type to begin.</span></div></form>
    <script>${bridge(grant)}
    (function($){
      var editor,dirty=false,saving=false;
      var status=document.getElementById('studio-status'),save=document.getElementById('studio-save');
      function failure(message){status.textContent=message;status.className='studio-error';save.disabled=false;saving=false;notify('error',{message:message});}
      function changed(){if(!dirty){dirty=true;notify('dirty');}}
      var settings=H5PIntegration.editor;
      H5PEditor.$=$;
      H5PEditor.basePath=settings.libraryUrl; H5PEditor.fileIcon=settings.fileIcon;
      H5PEditor.ajaxPath=settings.ajaxPath; H5PEditor.filesPath=settings.filesPath;
      H5PEditor.apiVersion=settings.apiVersion; H5PEditor.contentLanguage=settings.language;
      H5PEditor.copyrightSemantics=settings.copyrightSemantics; H5PEditor.metadataSemantics=settings.metadataSemantics;
      H5PEditor.assets=settings.assets; H5PEditor.baseUrl=''; H5PEditor.enableContentHub=false;
      if(settings.nodeVersionId!==undefined)H5PEditor.contentId=settings.nodeVersionId;
      H5PEditor.getAjaxUrl=function(action,parameters){var url=settings.ajaxPath+encodeURIComponent(action);Object.keys(parameters||{}).forEach(function(k){url+='&'+encodeURIComponent(k)+'='+encodeURIComponent(parameters[k]);});return url;};
      function mount(data){
        editor=new H5PEditor.Editor(data&&data.library,data&&JSON.stringify(data.params),document.getElementById('native-editor'),function(){
          this.document.addEventListener('input',changed,true);this.document.addEventListener('change',changed,true);
          this.addEventListener('error',function(){failure('An H5P editor script failed. Check its installed content libraries.');});
          this.addEventListener('unhandledrejection',function(){failure('The H5P editor could not finish loading. Check the connection and reopen it.');});
          this.H5P.jQuery(this.document).ajaxError(function(_event,response){failure(response.status===413?'The web proxy rejected this upload. Rebuild the web image with the H5P upload limits.':'The H5P editor could not load content or media. Check the connection and reopen it.');});
        });
        status.textContent='Draft changes are private until published.';
        var started=Date.now();
        (function ready(){
          if(editor.selector&&(!data||editor.selector.form)){notify('ready');return;}
          if(Date.now()-started<30000)setTimeout(ready,100);
        })();
      }
      $(document).ready(function(){
        if(H5PEditor.contentId){$.getJSON(${safeJson(model.urlGenerator.parameters())}+'/'+encodeURIComponent(H5PEditor.contentId)).then(mount).fail(function(){failure('The saved draft could not be loaded. Close and reopen the editor.');});}else mount();

      });
      document.getElementById('studio-form').addEventListener('submit',function(event){
        event.preventDefault();if(!editor||saving||!editor.selector){failure('Choose a content type and complete the required fields first.');return;}
        editor.getContent(function(content){
          if(!content||!content.library)return;
          saving=true;save.disabled=true;status.className='';status.textContent='Saving draft…';
          fetch(${safeJson(baseUrl + '/save')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({library:content.library,params:typeof content.params==='string'?JSON.parse(content.params):content.params})})
            .then(async function(response){var result=await response.json();if(!response.ok)throw new Error(result.error||'The draft could not be saved.');return result;})
            .then(function(result){dirty=false;status.textContent='Draft saved.';notify('saved',{activity:result.activity});})
            .catch(function(error){failure(error.message);});
        },function(){failure('Complete the required H5P fields before saving.');});
      });
      window.addEventListener('beforeunload',function(event){if(dirty){event.preventDefault();event.returnValue='';}});
    })(H5P.jQuery);
    </script></body></html>`;
}
export function playerDocument(model: IPlayerModel, grant: Grant): string {
  return `${head(model, 'Interactive activity')}<body><div class="h5p-content" data-content-id="${escapeHtml(String(model.contentId))}"></div>
    <script>${bridge(grant)}
      if(window.H5P&&H5P.externalDispatcher){
        H5P.externalDispatcher.on('initialized',function(){notify('ready');});
        H5P.externalDispatcher.on('xAPI',function(event){
        var statement=event.data&&event.data.statement;
        if(statement&&statement.verb&&/\\/(completed|passed|failed)$/.test(statement.verb.id||''))notify('progress');
      });}
    </script></body></html>`;
}
