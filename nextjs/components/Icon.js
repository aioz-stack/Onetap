export default function Icon({ name, className = 'icon' }) {
  return <svg className={className} aria-hidden="true"><use href={`/icons.svg#i-${name}`} /></svg>;
}
