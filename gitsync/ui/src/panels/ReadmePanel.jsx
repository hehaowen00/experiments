import { Show } from 'solid-js';
import { marked } from 'marked';
import Icon from '../components/Icon';
import { useWorkspace } from '../context/WorkspaceContext';

export default function ReadmePanel() {
  const ws = useWorkspace();

  function renderMarkdown() {
    const content = ws.readme().content;
    if (!content) return '';
    return marked.parse(content, { breaks: true });
  }

  return (
    <div class="git-readme-panel">
      <div class="git-readme-toolbar">
        <Show when={ws.readme().filename}>
          <span class="git-readme-filename">
            <Icon name="fa-solid fa-book" />
            {ws.readme().filename}
          </span>
        </Show>
        <div style={{ flex: 1 }} />
        <button class="btn btn-ghost btn-xs" onClick={ws.loadReadme} title="Refresh">
          <Icon name="fa-solid fa-rotate" />
        </button>
      </div>
      <Show when={ws.readme().content}>
        <div class="git-readme-content" innerHTML={renderMarkdown()} />
      </Show>
    </div>
  );
}
