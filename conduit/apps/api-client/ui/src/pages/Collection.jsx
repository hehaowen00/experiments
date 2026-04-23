import { onCleanup, onMount } from 'solid-js';
import { Icon, Modal, Select, t } from '@conduit/ui-shared';
import RequestPane from '../components/RequestPane';
import ResponsePane from '../components/ResponsePane';
import Sidebar from '../components/Sidebar';
import { CollectionProvider, useCollection } from '../store/collection';

function CollectionView(props) {
  const [state, actions] = useCollection();

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') actions.sendRequest();
  }

  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', onKeyDown);
  });

  function initSidebarResize(e) {
    e.preventDefault();
    const sidebar = e.target.previousElementSibling;
    const startX = e.clientX;
    const startW = sidebar.offsetWidth;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.target.classList.add('active');

    function onMove(ev) {
      sidebar.style.width = Math.max(0, startW + ev.clientX - startX) + 'px';
      sidebar.style.flex = '0 0 auto';
    }

    function onUp() {
      e.target.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function initPaneResize(e) {
    e.preventDefault();

    const pane = e.target.previousElementSibling;
    const isHorizontal = window.matchMedia('(min-aspect-ratio: 1/1)').matches;
    const startPos = isHorizontal ? e.clientX : e.clientY;
    const startSize = isHorizontal ? pane.offsetWidth : pane.offsetHeight;

    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    e.target.classList.add('active');

    function onMove(ev) {
      const delta = (isHorizontal ? ev.clientX : ev.clientY) - startPos;
      const newSize = Math.max(0, startSize + delta);
      if (isHorizontal) {
        pane.style.width = newSize + 'px';
        pane.style.height = '';
      } else {
        pane.style.height = newSize + 'px';
        pane.style.width = '';
      }
      pane.style.flex = '0 0 auto';
    }

    function onUp() {
      e.target.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function handleSelect(id) {
    actions.selectRequest(id);
    actions.setSidebarOpen(
      window.matchMedia('(min-aspect-ratio: 1/1)').matches,
    );
  }

  return (
    <div
      class={`collection-view ${state.sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}
      style={props.style}
    >
      {state.collection && (
        <>
          {state.sidebarOpen && (
            <>
              <Sidebar onSelect={handleSelect} />
              <div
                class="resize-handle resize-handle-sidebar"
                onMouseDown={initSidebarResize}
              />
            </>
          )}
          <div class="main-panel">
            <div class="request-bar">
              <button
                class="btn btn-ghost"
                onClick={() => actions.setSidebarOpen(!state.sidebarOpen)}
                title={t.sidebar.toggleSidebarTitle}
              >
                <Icon name="fa-solid fa-bars" />
              </button>
              <Select
                class="select-fw"
                value={state.protocol}
                options={[
                  { value: 'http', label: t.collection.protocols.http },
                  { value: 'ws', label: t.collection.protocols.ws },
                ]}
                onChange={(value) => actions.updateField('protocol', value)}
              />
              {state.protocol === 'http' && (
                <Select
                  class="select-fw"
                  value={state.method}
                  options={[
                    { value: 'GET', label: 'GET', color: '#50c878' },
                    { value: 'POST', label: 'POST', color: '#f0a030' },
                    { value: 'PUT', label: 'PUT', color: '#5090f0' },
                    { value: 'PATCH', label: 'PATCH', color: '#c070f0' },
                    { value: 'DELETE', label: 'DELETE', color: '#e05555' },
                    { value: 'HEAD', label: 'HEAD', color: '#8888aa' },
                    { value: 'OPTIONS', label: 'OPTIONS', color: '#8888aa' },
                  ]}
                  onChange={(value) => actions.updateField('method', value)}
                />
              )}
              <input
                type="text"
                class="url-input"
                placeholder={t.collection.urlPlaceholder}
                value={state.url}
                onInput={(e) => actions.updateField('url', e.target.value)}
                onPaste={actions.handleUrlPaste}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter')
                    actions.sendRequest();
                }}
              />
              <button
                class="btn btn-ghost"
                onClick={actions.importCurl}
                title={t.collection.curlButtonTitle}
              >
                <Icon name="fa-solid fa-terminal" />
              </button>
              {state.streamConnectionId ? (
                <button
                  class="btn btn-danger"
                  onClick={() => {
                    actions.appendStreamMessage(
                      'sys',
                      'system',
                      t.collection.disconnectedByUser,
                    );
                    actions.disconnectStream();
                  }}
                >
                  <Icon name="fa-solid fa-plug-circle-xmark" />
                </button>
              ) : (
                <button class="btn btn-primary" onClick={actions.sendRequest}>
                  <Icon name="fa-solid fa-paper-plane" />
                </button>
              )}
            </div>
            <div class="request-response-split">
              <RequestPane />
              <div
                class="resize-handle resize-handle-pane"
                style={{ display: state.responsePaneVisible ? '' : 'none' }}
                onMouseDown={initPaneResize}
              />
              <ResponsePane />
            </div>
          </div>
        </>
      )}
      <Modal />
    </div>
  );
}

export default function Collection(props) {
  return (
    <CollectionProvider id={props.id} onBack={props.onBack}>
      <CollectionView style={props.style} />
    </CollectionProvider>
  );
}
