export default function Icon(props) {
  return <i class={`${props.name}${props.class ? ' ' + props.class : ''}`} aria-hidden="true" />;
}
