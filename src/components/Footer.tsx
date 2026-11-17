import { Link } from 'react-router-dom'

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <div className="footer-brand">
            <img src="/icon-192.png" alt="" />
            <span className="brand-word">MovieFlix</span>
          </div>
          <p className="footer-text">
            Filmes e séries dublados em pt-BR, sem anúncios. Catálogo gratuito, em um só lugar.
          </p>
        </div>
        <div className="footer-links">
          <Link to="/filmes">Filmes</Link>
          <Link to="/series">Séries</Link>
          <Link to="/pesquisa">Pesquisar</Link>
          <Link to="/favoritos">Favoritos</Link>
          <Link to="/historico">Histórico</Link>
          <Link to="/baixar-app">Baixar apps</Link>
          <Link to="/configuracoes">Configurações</Link>
        </div>
      </div>
      <div
        className="footer-inner"
        style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}
      >
        <p className="footer-text" style={{ maxWidth: 'none' }}>
          © {new Date().getFullYear()} MovieFlix. Metadados e imagens fornecidos pelo TMDB. Este
          produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB.
        </p>
      </div>
    </footer>
  )
}
