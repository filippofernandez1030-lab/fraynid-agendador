(function(){
  // ---------- Configuración de la barbería ----------
  var BARBEROS = {
    "Fraynid": "8492675893",
    "Manuel": "8492675893"
  };
  // Duración de cada servicio en minutos (usada para calcular hora_fin y disponibilidad).
  // El barbero se toma 45 minutos sin importar el servicio elegido.
  var DURACIONES = {
    "Corte": 45,
    "Barba": 45,
    "Corte + Barba": 45,
    "Afeitado": 45
  };
  // Tema privado de ntfy.sh donde llegan los avisos de reserva a tu celular.
  // Instala la app ntfy (Android/iOS) o entra a https://ntfy.sh/app y suscríbete a este mismo tema.
  var NTFY_TOPIC = "fraynid-barbershop-reservas-83417";

  // ---------- Aviso automático al profesional (correo + evento en SU Google Calendar) ----------
  // Desplegado en script.google.com como Aplicación web ("Yo" / "Cualquier usuario").
  var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxTQl3dv6WuZU7NT0N3c63BqXz0CceuAhfNvjjjXSQwOkec1ebCIkFjKd9zrXrIm9MW/exec";

  function avisarAppsScript(nombreVal, telefonoVal, servicio, fechaISO, horaVal, duracionVal){
    if(!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf("URL_")===0) return;
    fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        servicio: servicio,
        fecha: fechaISO,
        hora: horaVal,
        duracion: duracionVal,
        nombre: nombreVal,
        telefono: telefonoVal
      })
    }).catch(function(){ /* sin conexión o error: se ignora, no bloquea la reserva */ });
  }

  var estado = { servicio:null, barbero:null, fecha:null, hora:null };

  // ---------- Modal del régimen de consecuencia (10 min de tolerancia / 40% de penalización) ----------
  // Se muestra una sola vez por visita, justo al terminar de elegir fecha y hora
  // (el momento en que el cliente ya comprometió un horario específico).
  var modalAvisoMostrado = false;
  var modalAviso = document.getElementById("modalAviso");
  var modalAvisoBtn = document.getElementById("modalAvisoBtn");

  function mostrarModalAviso(){
    if(modalAvisoMostrado) return;
    modalAvisoMostrado = true;
    modalAviso.classList.add("visible");
  }
  modalAvisoBtn.addEventListener("click",function(){
    modalAviso.classList.remove("visible");
  });

  // Pide permiso de notificaciones del navegador en cuanto carga la página
  // (sirve si esta pantalla se deja abierta en la tablet/PC del local).
  if("Notification" in window && Notification.permission==="default"){
    Notification.requestPermission();
  }

  function notificarNuevoCorte(nombreVal, fechaTxt, horaTxt, barbero){
    var msg = nombreVal+" reservó "+estado.servicio+" el "+fechaTxt+" a las "+horaTxt+" con "+barbero+".";

    if("Notification" in window && Notification.permission==="granted"){
      new Notification("💈 Nueva reserva de corte", { body: msg });
    }

    fetch("https://ntfy.sh/"+NTFY_TOPIC+
        "?title="+encodeURIComponent("Nueva reserva de corte")+
        "&priority=high&tags=scissors", {
      method:"POST",
      body: msg
    }).catch(function(){ /* sin conexión: se ignora, no bloquea la reserva */ });
  }

  // Fecha de hoy en español
  var hoy = new Date();
  function pad(n){ return (n<10?"0":"")+n; }
  function fechaLargaDe(d){
    var s = d.toLocaleDateString("es-ES",{weekday:"long",day:"numeric",month:"long"});
    return s.charAt(0).toUpperCase()+s.slice(1);
  }
  document.getElementById("fechaHoy").textContent = "Hoy · " + fechaLargaDe(hoy);

  // ---------- Horario de atención: lunes a viernes, 9:00 a 20:00 ----------
  // Todo en minutos desde medianoche para poder comparar y sumar duraciones fácilmente.
  var HORA_APERTURA = 9*60;          // 9:00, primer horario reservable
  var ULTIMA_HORA_INICIO = 19*60;    // 19:00, último horario reservable
  var HORA_CIERRE = 20*60;           // 20:00, hora tope en la que debe terminar cualquier cita
  var ABREV_DIA = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

  // Intervalos ocupados (en minutos) del barbero/fecha actualmente seleccionados.
  // Se llena con lo que devuelve Supabase cada vez que cambia barbero o fecha.
  var ocupadosActuales = [];

  var diasContenedor = document.getElementById("diasContenedor");
  var notaDias = document.getElementById("notaDias");
  var horasContenedor = document.getElementById("horasContenedor");
  var notaHoras = document.getElementById("notaHoras");
  var rangoBtns = Array.prototype.slice.call(document.querySelectorAll(".rango-btn"));

  // ---------- Utilidades de horas en minutos ----------
  function horaAMinutos(hStr){
    var p = hStr.split(":");
    return parseInt(p[0],10)*60 + parseInt(p[1],10);
  }
  function minutosAHora(min){
    return pad(Math.floor(min/60))+":"+pad(min%60);
  }
  function seSuperponen(aIni, aFin, bIni, bFin){
    return aIni < bFin && bIni < aFin;
  }

  // ---------- Consulta de disponibilidad a Supabase ----------
  // Llama a la función obtener_horas_ocupadas(p_barbero, p_fecha) (ver supabase-schema.sql),
  // que devuelve solo hora_inicio/hora_fin de las citas confirmadas, sin datos del cliente.
  function cargarDisponibilidad(barbero, fechaISO){
    notaHoras.textContent = "Cargando disponibilidad...";
    horasContenedor.innerHTML = "";

    if(!supabaseClient){
      ocupadosActuales = [];
      notaHoras.textContent = "Falta configurar Supabase (js/supabase-config.js).";
      return Promise.resolve();
    }

    return supabaseClient
      .rpc("obtener_horas_ocupadas", { p_barbero: barbero, p_fecha: fechaISO })
      .then(function(respuesta){
        if(respuesta.error){
          ocupadosActuales = [];
          notaHoras.textContent = "No se pudo cargar la disponibilidad. Intenta de nuevo.";
          return;
        }
        ocupadosActuales = (respuesta.data || []).map(function(fila){
          return {
            inicio: horaAMinutos(fila.hora_inicio.slice(0,5)),
            fin: horaAMinutos(fila.hora_fin.slice(0,5))
          };
        });
      });
  }

  function lunesDeSemana(d){
    var copia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dia = copia.getDay(); // 0=domingo
    var diferencia = dia===0 ? -6 : 1-dia;
    copia.setDate(copia.getDate()+diferencia);
    return copia;
  }

  function generarDias(rango){
    diasContenedor.innerHTML = "";
    horasContenedor.innerHTML = "";
    notaHoras.textContent = "Elige un día para ver las horas disponibles.";
    estado.fecha = null; estado.hora = null;
    ocupadosActuales = [];

    var hoyFecha = new Date(hoy.getFullYear(),hoy.getMonth(),hoy.getDate());
    var lista = [];

    if(rango==="semana"){
      var lunes = lunesDeSemana(hoy);
      for(var i=0;i<5;i++){
        var d = new Date(lunes.getFullYear(),lunes.getMonth(),lunes.getDate()+i);
        if(d.getTime()>=hoyFecha.getTime()) lista.push(d);
      }
    } else {
      var ultimoDia = new Date(hoy.getFullYear(),hoy.getMonth()+1,0).getDate();
      for(var diaMes=1; diaMes<=ultimoDia; diaMes++){
        var d2 = new Date(hoy.getFullYear(),hoy.getMonth(),diaMes);
        if(d2.getDay()>=1 && d2.getDay()<=5 && d2.getTime()>=hoyFecha.getTime()) lista.push(d2);
      }
    }

    if(lista.length===0){
      notaDias.textContent = rango==="semana"
        ? "No quedan días disponibles esta semana. Prueba con \"Este mes\"."
        : "No quedan días disponibles este mes.";
      actualizar();
      return;
    }
    notaDias.textContent = "Atendemos de lunes a viernes, de 9:00 a 20:00.";

    lista.forEach(function(d){
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dia";
      btn.setAttribute("role","radio");
      btn.setAttribute("aria-checked","false");
      btn.dataset.fecha = d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());

      var sem = document.createElement("span");
      sem.className = "dia-sem";
      sem.textContent = ABREV_DIA[d.getDay()];
      var num = document.createElement("span");
      num.className = "dia-num";
      num.textContent = d.getDate();
      btn.appendChild(sem);
      btn.appendChild(num);

      btn.addEventListener("click",function(){ seleccionarDia(btn, d); });
      diasContenedor.appendChild(btn);
    });

    actualizar();
  }

  function seleccionarDia(boton, fechaObj){
    diasContenedor.querySelectorAll(".dia").forEach(function(b){
      b.classList.remove("activo"); b.setAttribute("aria-checked","false");
    });
    boton.classList.add("activo");
    boton.setAttribute("aria-checked","true");
    estado.fecha = boton.dataset.fecha;
    estado.hora = null;
    actualizar();
    document.getElementById("paso4").scrollIntoView({behavior:"smooth",block:"start"});

    cargarDisponibilidad(estado.barbero, estado.fecha).then(function(){
      generarHoras(fechaObj);
      actualizar();
    });
  }

  // Genera la grilla de horas: deshabilita las que ya pasaron, las que se solapan
  // con una cita ya confirmada (según la duración del servicio elegido) y las que
  // harían que la cita terminara después del cierre.
  function generarHoras(fechaSeleccionada){
    horasContenedor.innerHTML = "";
    var esHoy = fechaSeleccionada.getFullYear()===hoy.getFullYear() &&
                fechaSeleccionada.getMonth()===hoy.getMonth() &&
                fechaSeleccionada.getDate()===hoy.getDate();
    var duracion = DURACIONES[estado.servicio] || 45;
    var huboDisponibles = false;

    for(var min=HORA_APERTURA; min<=ULTIMA_HORA_INICIO; min+=45){
      var hStr = minutosAHora(min);
      var finCita = min + duracion;
      var excedeCierre = finCita > HORA_CIERRE;
      var ocupada = ocupadosActuales.some(function(o){
        return seSuperponen(min, finCita, o.inicio, o.fin);
      });
      var yaPaso = false;
      if(esHoy){
        var h = Math.floor(min/60), mi = min%60;
        var slotFecha = new Date(hoy.getFullYear(),hoy.getMonth(),hoy.getDate(),h,mi,0,0);
        yaPaso = slotFecha.getTime() <= hoy.getTime();
      }

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hora";

      if(yaPaso || ocupada || excedeCierre){
        btn.disabled = true;
        btn.textContent = ocupada ? (hStr+" Ocupado") : hStr;
        btn.setAttribute("aria-label", hStr+(yaPaso?" ya pasó":(ocupada?" ocupada":" no disponible")));
      } else {
        btn.textContent = hStr;
        btn.dataset.hora = hStr;
        btn.setAttribute("role","radio");
        btn.setAttribute("aria-checked","false");
        btn.addEventListener("click",function(){ seleccionarHora(this); });
        huboDisponibles = true;
      }
      horasContenedor.appendChild(btn);
    }

    notaHoras.textContent = huboDisponibles
      ? "Las horas marcadas como \"Ocupado\" ya fueron reservadas."
      : (esHoy ? "Ya cerramos por hoy. Elige otro día." : "No quedan horas disponibles ese día.");
  }

  function seleccionarHora(boton){
    horasContenedor.querySelectorAll(".hora").forEach(function(b){
      b.classList.remove("activo"); b.setAttribute("aria-checked","false");
    });
    boton.classList.add("activo");
    boton.setAttribute("aria-checked","true");
    estado.hora = boton.dataset.hora;
    actualizar();
    document.getElementById("paso5").scrollIntoView({behavior:"smooth",block:"start"});
    nombre.focus({preventScroll:true});
    mostrarModalAviso();
  }

  rangoBtns.forEach(function(b){
    b.addEventListener("click",function(){
      rangoBtns.forEach(function(x){ x.classList.remove("activo"); x.setAttribute("aria-checked","false"); });
      b.classList.add("activo"); b.setAttribute("aria-checked","true");
      generarDias(b.dataset.rango);
    });
  });

  var nombre = document.getElementById("nombre");
  var telefono = document.getElementById("telefono");
  var aceptoAviso = document.getElementById("aceptoAviso");
  var btnReservar = document.getElementById("btnReservar");
  var TEXTO_BTN_RESERVAR = btnReservar.textContent;

  function seleccionar(grupo, boton, clave){
    grupo.forEach(function(b){
      b.classList.remove("activo");
      b.setAttribute("aria-checked","false");
    });
    boton.classList.add("activo");
    boton.setAttribute("aria-checked","true");
    estado[clave] = boton.dataset[clave];
    actualizar();
  }

  var servicios = Array.prototype.slice.call(document.querySelectorAll("#paso1 .servicio"));
  servicios.forEach(function(b){
    b.addEventListener("click",function(){
      seleccionar(servicios,b,"servicio");
      // Si ya había un día elegido, la duración del nuevo servicio puede cambiar
      // qué horas quedan disponibles: se recalcula con los datos ya cargados.
      if(estado.fecha){
        generarHoras(parseFechaISO(estado.fecha));
        actualizar();
      }
      document.getElementById("paso2").scrollIntoView({behavior:"smooth",block:"start"});
    });
  });

  var barberos = Array.prototype.slice.call(document.querySelectorAll("#paso2 .barbero"));
  barberos.forEach(function(b){
    b.addEventListener("click",function(){
      seleccionar(barberos,b,"barbero");
      // Cambiar de barbero cambia la disponibilidad: hay que volver a consultar Supabase.
      if(estado.fecha){
        cargarDisponibilidad(estado.barbero, estado.fecha).then(function(){
          generarHoras(parseFechaISO(estado.fecha));
          actualizar();
        });
      }
      document.getElementById("paso3").scrollIntoView({behavior:"smooth",block:"start"});
    });
  });

  generarDias("semana");

  nombre.addEventListener("input",actualizar);
  telefono.addEventListener("input",function(){
    telefono.value = telefono.value.replace(/[^\d\s+()-]/g,"");
    actualizar();
  });
  nombre.addEventListener("keydown",function(e){
    if(e.key==="Enter") telefono.focus();
  });
  aceptoAviso.addEventListener("change",actualizar);

  function completo(){
    return estado.servicio && estado.barbero && estado.fecha && estado.hora &&
           nombre.value.trim().length>=2 &&
           telefono.value.replace(/\D/g,"").length>=7 &&
           aceptoAviso.checked;
  }

  function actualizar(){
    marcarPaso("paso1", !!estado.servicio);
    marcarPaso("paso2", !!estado.barbero);
    marcarPaso("paso3", !!estado.fecha);
    marcarPaso("paso4", !!estado.hora);
    marcarPaso("paso5", nombre.value.trim().length>=2);
    marcarPaso("paso6", telefono.value.replace(/\D/g,"").length>=7);
    btnReservar.disabled = !completo();
  }
  function marcarPaso(id, listo){
    var p = document.getElementById(id);
    if(listo){ p.classList.add("listo"); p.querySelector(".paso-num").textContent="✓"; }
    else{
      p.classList.remove("listo");
      p.querySelector(".paso-num").textContent = id.replace("paso","");
    }
  }

  function horaAmPm(h24){
    var partes = h24.split(":");
    var h = parseInt(partes[0],10);
    var sufijo = h>=12 ? "PM" : "AM";
    var h12 = h%12; if(h12===0) h12=12;
    return h12+":"+partes[1]+" "+sufijo;
  }

  function parseFechaISO(iso){
    var p = iso.split("-");
    return new Date(parseInt(p[0],10), parseInt(p[1],10)-1, parseInt(p[2],10));
  }

  function fIcs(d){
    return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+"T"+
           pad(d.getHours())+pad(d.getMinutes())+"00";
  }

  btnReservar.addEventListener("click",function(){
    if(!completo()) return;
    reservarCita();
  });

  // Guarda la cita en Supabase. Si otro cliente reservó el mismo horario un
  // instante antes, la restricción de exclusión de la base de datos rechaza el
  // insert (código 23P01) y se lo hacemos saber al usuario sin guardar nada.
  function reservarCita(){
    var nombreVal = nombre.value.trim();
    var telefonoVal = telefono.value.trim();
    var barbero = estado.barbero;
    var servicio = estado.servicio;
    var duracion = DURACIONES[servicio] || 45;
    var horaInicio = estado.hora;
    var horaFin = minutosAHora(horaAMinutos(horaInicio) + duracion);

    if(!supabaseClient){
      notaHoras.textContent = "Falta configurar Supabase (js/supabase-config.js).";
      return;
    }

    btnReservar.disabled = true;
    btnReservar.textContent = "Reservando...";

    // Sin .select(): la tabla no tiene política de SELECT para el público
    // (protege nombre/teléfono de los clientes), así que no pedimos de vuelta
    // la fila insertada, solo confirmamos que el insert se aceptó.
    supabaseClient.from("citas").insert({
      servicio: servicio,
      duracion_minutos: duracion,
      barbero: barbero,
      fecha: estado.fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      nombre_cliente: nombreVal,
      telefono: telefonoVal,
      estado: "confirmada"
    }).then(function(respuesta){
      if(respuesta.error){
        btnReservar.textContent = TEXTO_BTN_RESERVAR;

        // 23P01 = violación de la restricción de exclusión (horario ya tomado).
        if(respuesta.error.code === "23P01" || respuesta.error.code === "23505"){
          notaHoras.textContent = "Este horario acaba de ser reservado. Selecciona otro.";
          estado.hora = null;
          cargarDisponibilidad(barbero, estado.fecha).then(function(){
            generarHoras(parseFechaISO(estado.fecha));
            actualizar();
          });
        } else {
          notaHoras.textContent = "No se pudo guardar la cita. Intenta de nuevo.";
          btnReservar.disabled = !completo();
        }
        return;
      }

      mostrarConfirmacion(nombreVal, telefonoVal, barbero, servicio, horaInicio);
    });
  }

  // Todo lo que pasa después de guardar la cita con éxito: WhatsApp, Google
  // Calendar, aviso al profesional vía Apps Script, y la pantalla de
  // confirmación. Se mantiene igual a como funcionaba antes de Supabase.
  function mostrarConfirmacion(nombreVal, telefonoVal, barbero, servicio, horaInicio){
    var horaTxt = horaAmPm(horaInicio);
    var telefonoBarbero = BARBEROS[barbero];
    var fechaCita = parseFechaISO(estado.fecha);
    var fechaLargaCita = fechaLargaDe(fechaCita);

    document.getElementById("rServicio").textContent = servicio;
    document.getElementById("rFecha").textContent = fechaLargaCita;
    document.getElementById("rHora").textContent = horaTxt;
    document.getElementById("rNombre").textContent = nombreVal;
    document.getElementById("rBarbero").textContent = barbero;

    // WhatsApp con mensaje ya escrito, al barbero elegido
    var msg = "Hola "+barbero+".\nAcabo de reservar una cita.\nNombre: "+nombreVal+
              "\nServicio: "+servicio+"\nFecha: "+fechaLargaCita+"\nHora: "+horaTxt+"\nNos vemos ese día.";
    var btnWhatsapp = document.getElementById("btnWhatsapp");
    btnWhatsapp.href = "https://wa.me/"+telefonoBarbero+"?text="+encodeURIComponent(msg);
    btnWhatsapp.dataset.textoOriginal = "Avisar a "+barbero+" por WhatsApp";
    btnWhatsapp.dataset.textoEnviado = "✅ Aviso enviado a "+barbero;
    document.getElementById("btnWhatsappTexto").textContent = btnWhatsapp.dataset.textoOriginal;

    // Aviso al dueño (push/navegador) cuando la reserva incluye un corte de pelo
    if(servicio.indexOf("Corte")!==-1){
      notificarNuevoCorte(nombreVal, fechaLargaCita, horaTxt, barbero);
    }

    // Aviso automático al profesional vía Google Apps Script (correo + evento en su Google Calendar)
    avisarAppsScript(nombreVal, telefonoVal, servicio, estado.fecha, horaInicio, DURACIONES[servicio] || 45);

    var ini = new Date(fechaCita);
    ini.setHours(parseInt(horaInicio.split(":")[0],10),
                 parseInt(horaInicio.split(":")[1],10),0,0);
    var duracion = DURACIONES[servicio] || 45;
    var fin = new Date(ini.getTime()+duracion*60000);

    // Enlace de Google Calendar para el cliente (lo confirma con un clic; no requiere iniciar sesión)
    var zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone;
    var detallesGCal = "Barbero: "+barbero+"\nCliente: "+nombreVal+"\nTeléfono: "+telefonoVal;
    document.getElementById("btnGoogleCalendar").href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE"+
      "&text="+encodeURIComponent("Cita en Fraynid Barbershop — "+servicio)+
      "&dates="+fIcs(ini)+"/"+fIcs(fin)+
      "&ctz="+encodeURIComponent(zonaHoraria)+
      "&details="+encodeURIComponent(detallesGCal)+
      "&location="+encodeURIComponent("Fraynid Barbershop");

    var confSub = document.getElementById("confSub");
    if(confSub) confSub.textContent = "Cita reservada correctamente.";

    // Mostrar confirmación en la misma pantalla
    document.getElementById("reserva").style.display="none";
    document.getElementById("barraReservar").style.display="none";
    document.getElementById("confirmacion").classList.add("visible");
    window.scrollTo({top:0,behavior:"smooth"});

    btnReservar.textContent = TEXTO_BTN_RESERVAR;
    btnReservar.disabled = true;
  }

  // Al hacer clic no se bloquea la apertura de WhatsApp: solo se actualiza el texto del botón.
  document.getElementById("btnWhatsapp").addEventListener("click",function(){
    var texto = document.getElementById("btnWhatsappTexto");
    if(this.dataset.textoEnviado) texto.textContent = this.dataset.textoEnviado;
  });

  document.getElementById("btnNueva").addEventListener("click",function(){
    estado = {servicio:null,barbero:null,fecha:null,hora:null};
    nombre.value=""; telefono.value=""; aceptoAviso.checked=false;
    modalAvisoMostrado = false;
    ocupadosActuales = [];
    document.getElementById("btnWhatsappTexto").textContent = "Avisar por WhatsApp";
    var confSub = document.getElementById("confSub");
    if(confSub) confSub.textContent = "Te esperamos. No necesitas hacer nada más.";
    document.querySelectorAll(".activo").forEach(function(b){
      b.classList.remove("activo"); b.setAttribute("aria-checked","false");
    });
    rangoBtns.forEach(function(x){ x.classList.remove("activo"); x.setAttribute("aria-checked","false"); });
    rangoBtns[0].classList.add("activo"); rangoBtns[0].setAttribute("aria-checked","true");
    generarDias("semana");
    actualizar();
    document.getElementById("confirmacion").classList.remove("visible");
    document.getElementById("reserva").style.display="";
    document.getElementById("barraReservar").style.display="";
    window.scrollTo({top:0});
  });
})();
