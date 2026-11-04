# RSS Feeder · Netlify

Tercera versión del lector RSS de Raúl Cámara, creada a partir de [RSS_feeder (Flask)](https://github.com/raulcamaracarreon/RSS_feeder) y [rss_feeder_streamlit](https://github.com/raulcamaracarreon/rss_feeder_streamlit).

## Funciones

- Lee fuentes **RSS 2.0, RSS/RDF y Atom** mediante una función serverless de Netlify.
- Parte de las 21 fuentes configuradas en la versión Flask de marzo de 2026.
- Permite agregar o eliminar fuentes y restablecer las originales.
- Filtra por texto y medio, ordena por fecha, elimina enlaces duplicados y muestra imágenes cuando existen.
- Incluye temas claro/oscuro y una opción para ocultar fechas.
- Guarda fuentes y preferencias en **localStorage del navegador**: no hay cuentas ni sincronización entre dispositivos.
- Muestra errores por fuente sin detener toda la consulta.

## Estructura

- `public/index.html`: interfaz web.
- `public/style.css`: estilos responsivos.
- `public/app.js`: gestión de estado, filtros y presentación.
- `netlify/functions/rss.mjs`: proxy RSS/Atom, descarga y análisis XML, con controles básicos de URL.
- `tests/rss.test.mjs`: pruebas unitarias del analizador.
- `netlify.toml`: configuración de despliegue.

## Uso local

Requiere Node.js 22 o posterior.

1. Clona el repositorio y entra en su carpeta.
2. Ejecuta `npm install`.
3. Ejecuta `npm test` para probar el analizador.
4. Ejecuta `npm run dev` para iniciar Netlify Dev (habitualmente en http://localhost:8888).

**Importante:** no abras directamente `public/index.html` como archivo local: la aplicación utiliza la función `/.netlify/functions/rss`.

## Publicación en Netlify

1. En Netlify selecciona **Add new project → Import an existing project**.
2. Conecta GitHub y elige `raulcamaracarreon/rss-feeder-netlify`.
3. Comprueba que la carpeta de publicación sea **`public`** y la carpeta de funciones **`netlify/functions`**. Ambas están definidas en `netlify.toml`.
4. No es necesario un comando de compilación ni variables de entorno para esta primera versión.
5. Publica el proyecto y prueba **Actualizar** y la incorporación de un feed.

## Consideraciones técnicas

- El navegador llama a la función Netlify; la función descarga XML desde fuentes externas para evitar restricciones CORS.
- Límites: 5 URL por petición, 35 entradas por fuente, 1.5 MB por feed y 9 segundos por descarga. La interfaz divide la lista en lotes.
- El backend valida el protocolo y el DNS, bloquea direcciones privadas conocidas, limita redirecciones y no acepta credenciales en URL. Estas medidas reducen riesgos de SSRF, pero **no sustituyen una allowlist y un proxy endurecido** si hay tráfico público intensivo.
- Algunos RSS podrían haber cambiado o dejado de estar disponibles desde marzo; sus errores se muestran en la interfaz.
- Las noticias e imágenes pertenecen a sus autores y medios de origen.
- Borrar el almacenamiento del navegador restablece las preferencias.

## Pendientes

- Validar en Netlify las 21 fuentes originales y actualizar las que hayan dejado de responder.
- Probar la interfaz en dispositivos móviles.
- Evaluar caché y límites adicionales antes de abrir la herramienta a tráfico intensivo.
