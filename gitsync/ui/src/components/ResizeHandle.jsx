import { onCleanup } from 'solid-js';

/**
 * Draggable resize handle for split panes.
 * @param {Object} props
 * @param {'col'|'row'} props.direction - 'col' for horizontal (left/right), 'row' for vertical (top/bottom)
 * @param {(delta: number) => void} props.onResize - called with pixel delta during drag
 */
export default function ResizeHandle(props) {
  let startPos = 0;
  let handleEl;

  function onMouseDown(e) {
    e.preventDefault();
    startPos = props.direction === 'col' ? e.clientX : e.clientY;
    handleEl?.classList.add('active');
    document.body.style.cursor =
      props.direction === 'col' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    const current = props.direction === 'col' ? e.clientX : e.clientY;
    const delta = current - startPos;
    startPos = current;
    props.onResize(delta);
  }

  function onMouseUp() {
    handleEl?.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  onCleanup(() => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  });

  return (
    <div
      ref={handleEl}
      class={`git-resize-handle ${props.direction === 'col' ? 'git-resize-handle-col' : 'git-resize-handle-row'}`}
      onMouseDown={onMouseDown}
    />
  );
}
