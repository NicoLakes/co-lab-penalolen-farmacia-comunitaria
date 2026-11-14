import logoPenalolen from '../assets/logo-penalolen.png';

// Logo municipal sobre recuadro blanco: idéntico en todos los apartados
// (catálogo del vecino, login y panel de funcionarios).
export function LogoMuni() {
  return (
    <span className="logo-muni-wrap">
      <img src={logoPenalolen} alt="Municipalidad de Peñalolén" className="logo-muni" />
    </span>
  );
}
