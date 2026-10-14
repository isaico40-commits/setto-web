# Setto · sitio web + panel del equipo

- **Sitio público** (`index.html`): edición especial, sets, carta, pedido de take away que se envía a WhatsApp con un código (STT-1234) y consulta de la tarjeta del Setto Club.
- **Panel del equipo** (`panel.html` o `/panel`): pedidos pendientes, botón "Entregado" que suma sellos, Club (sellos manuales y canje), carta con fotos, y ajustes.
- **Base de datos:** Supabase (plan gratis). **Hosting:** Vercel (plan gratis).

Sin las claves de Supabase, todo funciona en **modo demo**: los datos quedan guardados solo en el navegador. Sirve para probar el flujo antes de configurar nada.

---

> **Estado (13/10/2026):** los pasos 1, 2 y 3 ya están hechos. La base está instalada en el proyecto de Supabase `vqgfckswnqoekotmsyam` y `js/config.js` ya tiene la URL y la clave pública. Faltan el paso 4 (usuarios) y el 5 (publicar).

## Puesta en marcha (unos 20 minutos)

### 1. Crear la base en Supabase
1. Entrá a https://supabase.com, creá una cuenta y tocá **New project**.
2. Nombre: `setto`. Región: la más cercana (South America · São Paulo). Guardá la contraseña de la base en un lugar seguro.
3. Esperá que termine de crearse (1–2 minutos).

### 2. Cargar las tablas y la carta
1. En el proyecto, andá a **SQL Editor → New query**.
2. Abrí `supabase/schema.sql`, copiá **todo** el contenido, pegalo y tocá **Run**.
3. Tiene que decir *Success*. Este archivo crea las tablas, la seguridad, las funciones de pedidos y sellos, la carpeta de fotos y la carta de octubre. Si lo corrés de nuevo, no borra nada de lo que ya cargaste.

### 3. Conectar el sitio con la base
1. En Supabase andá a **Project Settings → API**.
2. Copiá **Project URL** y la key **anon public**.
3. Pegalas en `js/config.js`:
   ```js
   window.SETTO_CONFIG = {
     supabaseUrl: "https://xxxx.supabase.co",
     supabaseAnonKey: "eyJhbGciOi..."
   };
   ```
   La key `anon` es pública: es normal que se vea en el navegador. La seguridad la dan las reglas de la base.
   **No pegues nunca la key `service_role`.**

### 4. Crear los usuarios del equipo (Isa, Alan, Lucas)
1. **Authentication → Users → Add user → Create new user**. Poné email y contraseña, y marcá *Auto Confirm User*.
2. Repetí para cada persona.
3. Habilitalos como equipo en **SQL Editor**, cambiando los emails:
   ```sql
   insert into public.staff (user_id, nombre)
   select id, 'Isa' from auth.users where email = 'isa@ejemplo.com'
   on conflict do nothing;
   ```
   (Uno por persona, cambiando el nombre y el email.)
4. Recomendado: en **Authentication → Providers/Sign In → Email**, desactivá que se pueda registrar gente nueva (*Allow new users to sign up*). Así nadie puede crearse una cuenta sola. Aunque alguien lo hiciera, sin estar en `staff` no ve ni toca nada.

### 5. Publicar en Vercel
**Opción A · con GitHub (recomendada, se actualiza sola en cada cambio):**
1. Subí esta carpeta a un repositorio de GitHub.
2. Entrá a https://vercel.com con tu cuenta de GitHub → **Add New → Project** → elegí el repositorio.
3. Framework Preset: **Other**. No hace falta build. Tocá **Deploy**.

**Opción B · desde la terminal:**
```bash
cd setto-web
npx vercel        # la primera vez te pide loguearte
npx vercel --prod
```

Te queda una dirección como `setto.vercel.app`. El panel está en `setto.vercel.app/panel`.
Si después comprás un dominio (por ejemplo `setto.com.ar`), se conecta en Vercel → Settings → Domains.

---

## Cómo se usa día a día

1. **El cliente pide en la web.** Elige productos, nombre, celular, horario y forma de pago. La web registra el pedido con un código (ej. `STT-4821`) y le abre WhatsApp con el mensaje armado.
2. **Llega el WhatsApp.** En el panel, pestaña **Pedidos**, aparece el pedido al instante con el mismo código.
3. **Revisás el número.** El campo "Número del chat de WhatsApp" viene con el número que puso el cliente. Si en el chat aparece otro número, lo corregís ahí.
4. **Al retirar, tocás "Entregado ✓".** Se suman los sellos al número del chat (1 por defecto, lo podés cambiar antes de tocar).
5. **El cliente consulta su tarjeta** en la web, en la sección Setto Club, con su celular.
6. **Canje:** en el panel, pestaña **Club**, buscás al cliente y tocás **Canjear premio** cuando completó la tarjeta.

Pedidos que no vienen de la web (WhatsApp directo, PedidosYa, Rappi, Uber Eats): pestaña **Club → Sumar sellos a mano**.

### Envío a domicilio
En el checkout el cliente elige **Retiro** o **Envío a domicilio**. Si elige envío, tiene que poner la dirección exacta (y opcionalmente piso/depto/referencia). En el panel el pedido aparece con la etiqueta **Envío a domicilio**, la dirección y un link a Google Maps.
En **Ajustes → Envío a domicilio** activás o desactivás la opción, ponés un costo fijo (0 = se coordina por WhatsApp) y el aviso que ve el cliente.
Con envío, la única forma de pago es **transferencia** (el envío lo hace Uber y no cobra los productos). La base rechaza un pedido con envío y otro medio de pago. En el mismo ajuste elegís cuál es esa forma de pago.

### Premio del Club
El premio se entrega **en el mismo pedido que completa la tarjeta**. Ejemplo con 8 sellos: el cliente con 7 sellos hace su pedido y en el checkout **elige su premio**:
- **Un set de regalo** (cualquier set activo, en 12 oz): se suma al pedido a $0.
- **25% off en ese pedido**: se descuenta del total de productos (sin envío), redondeado a $10.

Sin elegir, la web no deja enviar. El panel muestra 🎁 *Completa la tarjeta* con el premio elegido, y al tocar **Entregado** se canjea solo (la tarjeta vuelve a 0).
En **Ajustes → Setto Club** definís los sellos de la tarjeta, el texto del premio, si se ofrece el set, el % de descuento (0 = no se ofrece), un tope en $ para el descuento (0 = sin tope) y un pedido mínimo opcional para sumar sello.

### Personalización de bebidas
En los dirty y en los sets el cliente elige la leche (con recargo) y puede marcar "Sin cold foam", "Sin endulzante" o "Sin hielo". El recargo se suma al precio y se calcula en la base. En el WhatsApp y en el panel cada bebida muestra lo que eligió.
En **Ajustes → Personalización de bebidas** cambiás las leches (una por línea, `Nombre | recargo`, la primera es la de base) y las opciones para sacar.

### Edición especial (sabores de tortas)
En **Carta → Edición especial**:
- **Estado:** *Próximamente* (se muestra pero no se puede pedir) o *Disponible ahora* (se puede pedir).
- **Etiqueta de arriba:** por ejemplo "Edición de noviembre · del 14 al 16".
- En cada sabor: foto, precio (si está en 0, figura "a confirmar" y no se puede pedir), *Agotado* y *Visible en la web*.

### Fotos
"Subir foto" recorta la imagen cuadrada, la achica y la sube a Supabase Storage. Después tocá **Guardar** en esa tarjeta para que se vea en la web.

---

## Seguridad (lo importante)
- Los **precios se calculan en la base**, no en el navegador. Si alguien modifica la página para cambiar un precio, el pedido se guarda igual con el precio real.
- Los clientes **no pueden ver pedidos ni datos de otros clientes**. Al consultar la tarjeta solo ven la cantidad de sellos de ese número.
- **Solo el equipo** (usuarios en la tabla `staff`) puede confirmar pedidos, sumar sellos, canjear y editar la carta.
- Límite anti-spam: máximo 6 pedidos por celular por hora.

## Límites del plan gratis
- **Supabase Free:** sobra para empezar (base de datos, fotos y usuarios). Si el proyecto pasa alrededor de una semana sin actividad, Supabase puede pausarlo; se reactiva desde su panel con un clic. Revisá los límites actuales en https://supabase.com/pricing.
- **Vercel Hobby:** gratis para sitios personales. Si Setto crece y factura por la web, revisá si corresponde el plan Pro: https://vercel.com/pricing.

## Lo que viene (no está en esta versión)
- **Verificación por código** (como Crumbl) para que el cliente vea su tarjeta solo después de confirmar su número por WhatsApp o SMS.
- Pago online con Mercado Pago.
- Pedidos para eventos/regalo y gift cards.

---

## Archivos
```
index.html          sitio público
panel.html          panel del equipo
css/site.css        estilos (sistema visual Setto)
css/panel.css       estilos del panel
js/config.js        ← acá van las claves de Supabase
js/api.js           conexión a Supabase / modo demo
js/site.js          lógica del sitio
js/panel.js         lógica del panel
js/seed.js          carta inicial para el modo demo
data/seed.json      carta inicial (fuente)
supabase/schema.sql tablas, seguridad, funciones y carta inicial
img/                fotos de producto, logo, Mochito y patrón
vercel.json         config de Vercel (url /panel, caché de imágenes)
```

### Probar en tu compu
```bash
cd setto-web
python3 -m http.server 8000
# abrí http://localhost:8000 y http://localhost:8000/panel.html
```
