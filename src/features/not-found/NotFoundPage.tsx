import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="text-sm font-medium text-blue-300">Eroare 404</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">
          Pagina nu există
        </h1>
        <Link
          to="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-500"
        >
          Înapoi la dashboard
        </Link>
      </div>
    </main>
  )
}
