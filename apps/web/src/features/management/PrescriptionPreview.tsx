import { useState } from 'react';

const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const zoomLevels = [50, 75, 100, 125, 150, 175, 200] as const;
const defaultZoomIndex = 2;

export function PrescriptionPreview({ url, mimeType }: { url: string; mimeType: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(defaultZoomIndex);
  if (!imageTypes.includes(mimeType)) return null;

  const zoom = zoomLevels[zoomIndex] ?? 100;
  return (
    <div className="prescription-preview">
      <button type="button" className="btn-secundario" aria-expanded={open} onClick={() => {
        setOpen(!open);
        setZoomIndex(defaultZoomIndex);
        setFailed(false);
      }}>
        {open ? 'Cerrar vista previa' : 'Previsualizar receta'}
      </button>
      {open && (failed ? (
        <p role="alert">No pudimos mostrar la imagen. Intenta abrir la receta adjunta.</p>
      ) : (
        <>
          <div className="prescription-zoom" role="group" aria-label="Zoom de la receta">
            <button type="button" className="btn-secundario" aria-label="Reducir zoom"
              disabled={zoomIndex === 0} onClick={() => setZoomIndex(zoomIndex - 1)}>−</button>
            <span aria-live="polite">{zoom}%</span>
            <button type="button" className="btn-secundario" aria-label="Aumentar zoom"
              disabled={zoomIndex === zoomLevels.length - 1} onClick={() => setZoomIndex(zoomIndex + 1)}>+</button>
            <button type="button" className="btn-secundario" disabled={zoomIndex === defaultZoomIndex}
              onClick={() => setZoomIndex(defaultZoomIndex)}>Restablecer</button>
          </div>
          <div className="prescription-preview-scroll">
            <img src={url} style={{ width: `${zoom}%` }} alt="Imagen de la receta adjunta"
              onError={() => setFailed(true)} />
          </div>
        </>
      ))}
    </div>
  );
}
