// km-geraet.js – Kilometer direkt auf dem Gerät berechnen
//
// Dieses Programm läuft als Hintergrund-Helfer (Web Worker) in der App.
// Es nutzt ein Kartenpaket (Straßennetz und Adressverzeichnis aus
// OpenStreetMap), das einmal von der eigenen App-Adresse geladen und auf dem
// Gerät gespeichert wird. Danach werden Adressen gesucht und Strecken
// berechnet, OHNE dass irgendetwas das Gerät verlässt – auch ohne Internet.
//
// Kartendaten © OpenStreetMap-Mitwirkende, Lizenz ODbL.
//
// Nachrichten von der App:
//   {nr, typ:'status'}                       → welche Pakete sind gespeichert?
//   {nr, typ:'herunterladen', paket}         → Paket laden und speichern (meldet Fortschritt)
//   {nr, typ:'loeschen', paket}              → Paket vom Gerät entfernen
//   {nr, typ:'route', paket, adressen}       → Kilometer berechnen
//   {nr, typ:'strassen', paket, grenzen}     → Straßen für die Karte im Ausschnitt
// Antwort: {nr, ok:true, ergebnis} oder {nr, ok:false, fehler}; Fortschritt: {nr, fortschritt}

'use strict';

const SPEICHER = 'qa-karten-1';        // Name des Gerätespeichers für Kartenpakete
const ORDNER = './karten/';

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

// Muss genau wie normalisieren() in werkzeuge/kartenpaket/bauen.py arbeiten
function norm(text){
  return String(text||'').toLowerCase()
    .replace(/ß/g,'ss').replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue')
    .replace(/str(asse|\.|\b)/g,'str')
    .replace(/[^a-z0-9]/g,'');
}

const ERDRADIUS=6371008.8;
function abstandM(lat1,lon1,lat2,lon2){
  const p1=lat1*Math.PI/180,p2=lat2*Math.PI/180;
  const dp=p2-p1,dl=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*ERDRADIUS*Math.asin(Math.sqrt(a));
}

// Polyline (5 Stellen) wie bei den bisherigen Routendiensten, damit die
// Karte in der App unverändert weiterarbeitet
function polylineKodieren(punkte){
  let text='',vorLat=0,vorLon=0;
  const zahl=w=>{
    let v=w<0?~(w<<1):(w<<1),t='';
    while(v>=0x20){t+=String.fromCharCode((0x20|(v&0x1f))+63);v>>=5;}
    return t+String.fromCharCode(v+63);
  };
  for(const [lat,lon] of punkte){
    const la=Math.round(lat*1e5),lo=Math.round(lon*1e5);
    text+=zahl(la-vorLat)+zahl(lo-vorLon);
    vorLat=la;vorLon=lo;
  }
  return text;
}

async function entpacken(puffer){
  const b=new Uint8Array(puffer);
  // Manche Server entpacken .gz-Dateien schon unterwegs – dann ist nichts mehr zu tun
  if(b.length<2||b[0]!==0x1f||b[1]!==0x8b)return puffer;
  const strom=new Blob([puffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(strom).arrayBuffer();
}

// ---------------------------------------------------------------------------
// Straßennetz
// ---------------------------------------------------------------------------
function netzLesen(puffer){
  const dv=new DataView(puffer);
  const kennung=String.fromCharCode(...new Uint8Array(puffer,0,4));
  if(kennung!=='QAKM')throw new Error('Kartenpaket ist beschädigt. Bitte neu herunterladen.');
  const version=dv.getUint32(4,true);
  if(version!==1)throw new Error('Kartenpaket hat eine unbekannte Version. Bitte neu herunterladen.');
  const N=dv.getUint32(8,true),E=dv.getUint32(12,true),G=dv.getUint32(16,true);
  let pos=20;
  const i32=n=>{const a=new Int32Array(puffer.slice(pos,pos+4*n));pos+=4*n;return a;};
  const u32=n=>{const a=new Uint32Array(puffer.slice(pos,pos+4*n));pos+=4*n;return a;};
  const u8=n=>{const a=new Uint8Array(puffer.slice(pos,pos+n));pos+=n;return a;};
  const netz={N,E,G};
  netz.lat=i32(N);netz.lon=i32(N);
  netz.von=u32(E);netz.nach=u32(E);netz.laenge=u32(E);
  netz.tempo=u8(E);netz.art=u8(E);
  pos+=(4-(2*E)%4)%4;
  netz.zwAnfang=u32(E+1);netz.zwLat=i32(G);netz.zwLon=i32(G);

  // Nachbarliste (wer ist von welcher Kreuzung aus erreichbar)
  const zahl=new Uint32Array(N+1);
  for(let e=0;e<E;e++){
    const a=netz.art[e];
    if(!(a&32))zahl[netz.von[e]+1]++;   // vorwärts erlaubt
    if(!(a&16))zahl[netz.nach[e]+1]++;  // rückwärts erlaubt
  }
  for(let i=0;i<N;i++)zahl[i+1]+=zahl[i];
  const erster=zahl.slice();
  const ziel=new Uint32Array(zahl[N]);
  const kante=new Uint32Array(zahl[N]);
  const fuell=zahl.slice(0,N);
  for(let e=0;e<E;e++){
    const a=netz.art[e];
    if(!(a&32)){const p=fuell[netz.von[e]]++;ziel[p]=netz.nach[e];kante[p]=e;}
    if(!(a&16)){const p=fuell[netz.nach[e]]++;ziel[p]=netz.von[e];kante[p]=e;}
  }
  netz.erster=erster;netz.ziel=ziel;netz.kante=kante;

  // Fahrzeit je Kante in Zehntelsekunden (Länge in dm / Tempo)
  netz.zeit=new Float32Array(E);
  let hoechst=0;
  for(let e=0;e<E;e++){
    const ms=netz.tempo[e]/3.6;
    if(ms>hoechst)hoechst=ms;
    netz.zeit[e]=netz.laenge[e]/10/ms;
  }
  netz.hoechstMs=hoechst||36;

  // Grobes Raster für die Suche nach der nächsten Straße
  netzRaster(netz);
  return netz;
}

// Punkte einer Kante (Grad), in Richtung von → nach
function kantenPunkte(netz,e){
  const p=[[netz.lat[netz.von[e]]/1e6,netz.lon[netz.von[e]]/1e6]];
  for(let i=netz.zwAnfang[e];i<netz.zwAnfang[e+1];i++)p.push([netz.zwLat[i]/1e6,netz.zwLon[i]/1e6]);
  p.push([netz.lat[netz.nach[e]]/1e6,netz.lon[netz.nach[e]]/1e6]);
  return p;
}

// Raster mit Zellen von etwa 1 km: jede Kante wird in allen Zellen eingetragen,
// die sie berührt. So muss beim Suchen nur die nähere Umgebung geprüft werden.
const ZELLE_LAT=0.009,ZELLE_LON=0.014;
function zelle(lat,lon){return Math.floor(lat/ZELLE_LAT)*100000+Math.floor(lon/ZELLE_LON)}
function netzRaster(netz){
  const zaehler=new Map();
  const zellenJeKante=[];
  for(let e=0;e<netz.E;e++){
    const pk=kantenPunkte(netz,e);
    let la0=Infinity,la1=-Infinity,lo0=Infinity,lo1=-Infinity;
    for(const [la,lo] of pk){if(la<la0)la0=la;if(la>la1)la1=la;if(lo<lo0)lo0=lo;if(lo>lo1)lo1=lo;}
    const z=[];
    for(let a=Math.floor(la0/ZELLE_LAT);a<=Math.floor(la1/ZELLE_LAT);a++)
      for(let b=Math.floor(lo0/ZELLE_LON);b<=Math.floor(lo1/ZELLE_LON);b++){
        const k=a*100000+b;z.push(k);zaehler.set(k,(zaehler.get(k)||0)+1);
      }
    zellenJeKante.push(z);
  }
  // Kompakt ablegen: Zelle → Abschnitt in einer langen Liste
  const anfang=new Map();let summe=0;
  for(const [k,n] of zaehler){anfang.set(k,summe);summe+=n;}
  const liste=new Uint32Array(summe);
  const fuell=new Map(anfang);
  zellenJeKante.forEach((z,e)=>{for(const k of z){const p=fuell.get(k);liste[p]=e;fuell.set(k,p+1);}});
  netz.raster={anfang,anzahl:zaehler,liste};
}

// Nächste befahrbare Stelle zu einem Punkt (keine Autobahn, keine Auffahrt –
// außer bei Zwischenpunkten, die man auf der Karte auf eine Autobahn zieht)
function naechsteStrasse(netz,lat,lon,auchSchnell){
  const kx=111320*Math.cos(lat*Math.PI/180),ky=110540;
  let beste=null;
  for(let ring=0;ring<=6;ring++){
    const za=Math.floor(lat/ZELLE_LAT),zb=Math.floor(lon/ZELLE_LON);
    for(let a=za-ring;a<=za+ring;a++)for(let b=zb-ring;b<=zb+ring;b++){
      if(Math.max(Math.abs(a-za),Math.abs(b-zb))!==ring)continue;
      const k=a*100000+b;
      const start=netz.raster.anfang.get(k);
      if(start===undefined)continue;
      const ende=start+netz.raster.anzahl.get(k);
      for(let p=start;p<ende;p++){
        const e=netz.raster.liste[p];
        const klasse=netz.art[e]&15;
        if(klasse<=2&&!auchSchnell)continue;
        const pk=kantenPunkte(netz,e);
        let entlang=0;
        for(let i=1;i<pk.length;i++){
          const ax=pk[i-1][1]*kx,ay=pk[i-1][0]*ky,bx=pk[i][1]*kx,by=pk[i][0]*ky;
          const px=lon*kx,py=lat*ky;
          const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;
          const t=l2?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2)):0;
          const d=Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
          const stueck=Math.sqrt(l2);
          if(!beste||d<beste.d){
            beste={d,e,entlang:entlang+t*stueck,punkt:[(ay+t*dy)/ky,(ax+t*dx)/kx]};
          }
          entlang+=stueck;
        }
      }
    }
    // Weiter außen kann nichts Näheres mehr liegen
    if(beste&&beste.d<ring*ZELLE_LAT*ky)break;
  }
  if(!beste)return null;
  // Strecke entlang der Kante auf die gespeicherte (genaue) Länge umrechnen
  const gesamt=netz.laenge[beste.e]/10;
  const pk=kantenPunkte(netz,beste.e);
  let geom=0;for(let i=1;i<pk.length;i++)geom+=Math.hypot((pk[i][1]-pk[i-1][1])*kx,(pk[i][0]-pk[i-1][0])*ky);
  beste.vonAnfang=geom?beste.entlang/geom*gesamt:0;
  beste.bisEnde=gesamt-beste.vonAnfang;
  return beste;
}

// ---------------------------------------------------------------------------
// Kürzeste Fahrzeit zwischen zwei Stellen (A*-Suche), Ergebnis in Metern
// ---------------------------------------------------------------------------
// Kleiner Zuschlag pro durchfahrener Kreuzung: bevorzugt durchgehende Straßen
// mit wenig Abbiegen (ähnlich „less_maneuvers“).
const KREUZUNG_S=2;

class Halde{
  constructor(){this.k=[];this.w=[];}
  get leer(){return this.k.length===0}
  rein(knoten,wert){
    const k=this.k,w=this.w;let i=k.length;k.push(knoten);w.push(wert);
    while(i>0){const p=(i-1)>>1;if(w[p]<=wert)break;k[i]=k[p];w[i]=w[p];i=p;}
    k[i]=knoten;w[i]=wert;
  }
  raus(){
    const k=this.k,w=this.w,oben=k[0],obenW=w[0];
    const lk=k.pop(),lw=w.pop();
    if(k.length){
      let i=0;const n=k.length;
      for(;;){let c=2*i+1;if(c>=n)break;if(c+1<n&&w[c+1]<w[c])c++;if(w[c]>=lw)break;k[i]=k[c];w[i]=w[c];i=c;}
      k[i]=lk;w[i]=lw;
    }
    return [oben,obenW];
  }
}

function strecke(netz,a,b){
  // a, b: Ergebnisse von naechsteStrasse()
  const {N}=netz;
  if(!netz.g){netz.g=new Float64Array(N).fill(Infinity);netz.vor=new Int32Array(N).fill(-1);netz.beruehrt=[];}
  const g=netz.g,vor=netz.vor;
  for(const i of netz.beruehrt){g[i]=Infinity;vor[i]=-1;}
  netz.beruehrt=[];
  const zeitJeM=e=>netz.zeit[e]/(netz.laenge[e]/10||1);

  let bester=Infinity,besterWeg=null;

  // Beide auf derselben Kante: direkt fahren, wenn die Richtung erlaubt ist
  if(a.e===b.e){
    const art=netz.art[a.e];
    const vorwaerts=b.vonAnfang>=a.vonAnfang;
    if((vorwaerts&&!(art&32))||(!vorwaerts&&!(art&16))){
      const m=Math.abs(b.vonAnfang-a.vonAnfang);
      bester=m*zeitJeM(a.e);besterWeg={direkt:true,meter:m};
    }
  }

  const zielLat=b.punkt[0],zielLon=b.punkt[1];
  const h=i=>abstandM(netz.lat[i]/1e6,netz.lon[i]/1e6,zielLat,zielLon)/netz.hoechstMs;
  const halde=new Halde();
  const startKnoten=[];
  const artA=netz.art[a.e];
  // vom Startpunkt zur Kreuzung am Anfang (gegen die Kantenrichtung) …
  if(!(artA&16))startKnoten.push([netz.von[a.e],a.vonAnfang]);
  // … oder zur Kreuzung am Ende (in Kantenrichtung)
  if(!(artA&32))startKnoten.push([netz.nach[a.e],a.bisEnde]);
  for(const [k,m] of startKnoten){
    const t=m*zeitJeM(a.e);
    if(t<g[k]){g[k]=t;vor[k]=-2;netz.beruehrt.push(k);halde.rein(k,t+h(k));}
  }
  // Ziel: von einer der beiden Kreuzungen der Zielkante aus
  const artB=netz.art[b.e];
  const zielEnde=new Map();
  if(!(artB&32))zielEnde.set(netz.von[b.e],b.vonAnfang);   // vorwärts hinein
  if(!(artB&16))zielEnde.set(netz.nach[b.e],b.bisEnde);    // rückwärts hinein
  let zielKnoten=-1;

  let schritte=0;
  while(!halde.leer){
    const [u,f]=halde.raus();
    if(f>=bester)break;
    const gu=g[u];
    if(f-h(u)>gu+1e-9)continue; // veralteter Eintrag
    if(zielEnde.has(u)){
      const t=gu+zielEnde.get(u)*zeitJeM(b.e);
      if(t<bester){bester=t;zielKnoten=u;besterWeg=null;}
    }
    if(++schritte>5e6)break;
    for(let p=netz.erster[u];p<netz.erster[u+1];p++){
      const v=netz.ziel[p],e=netz.kante[p];
      const t=gu+netz.zeit[e]+KREUZUNG_S;
      if(t<g[v]){
        if(g[v]===Infinity)netz.beruehrt.push(v);
        g[v]=t;vor[v]=p;
        halde.rein(v,t+h(v));
      }
    }
  }
  if(bester===Infinity)return null;
  if(besterWeg&&besterWeg.direkt){
    return {meter:besterWeg.meter,punkte:[a.punkt,b.punkt]};
  }

  // Weg zurückverfolgen: Meter zählen und Linie für die Karte sammeln
  const stuecke=[];
  let u=zielKnoten,meter=zielEnde.get(zielKnoten);
  while(vor[u]>=0){
    const e=netz.kante[vor[u]];
    meter+=netz.laenge[e]/10;
    // In Kantenrichtung gefahren, wenn die Kante bei u endet
    const vorwaerts=netz.nach[e]===u;
    const pk=kantenPunkte(netz,e);
    stuecke.push(vorwaerts?pk:pk.reverse());
    u=vorwaerts?netz.von[e]:netz.nach[e];
  }
  // u ist jetzt eine der Startkreuzungen: Stück vom Startpunkt dorthin
  meter+=new Map(startKnoten).get(u)||0;
  const punkte=[a.punkt];
  stuecke.reverse().forEach(s=>punkte.push(...s));
  punkte.push(b.punkt);
  return {meter,punkte};
}

// ---------------------------------------------------------------------------
// Adressverzeichnis
// ---------------------------------------------------------------------------
function adressenLesen(text){
  const d=JSON.parse(text);
  const verz={orte:d.orte,strassen:d.strassen,pois:d.pois,nachName:new Map(),ortNorm:d.orte.map(norm)};
  d.strassen.forEach((s,i)=>{
    const l=verz.nachName.get(s[0]);
    if(l)l.push(i);else verz.nachName.set(s[0],[i]);
  });
  verz.namenListe=[...verz.nachName.keys()].sort();
  verz.platzSuchen=w=>{
    if(verz.plaetze.has(w))return verz.plaetze.get(w);
    if(w.length<4)return null;
    const l=[];
    for(const [k,v] of verz.plaetze)if(k.startsWith(w))l.push(...v);
    return l.length?l:null;
  };
  // Städte und Stadtteile: Suchname → [{name, stufe, lat, lon}]
  verz.plaetze=new Map();
  (d.plaetze||[]).forEach(([n,name,stufe,la,lo])=>{
    const l=verz.plaetze.get(n)||[];l.push({name,stufe,lat:la/1e5,lon:lo/1e5});verz.plaetze.set(n,l);
  });
  return verz;
}

// Lage aller Hausnummern einer Straße entpacken
function hausnummern(s){
  if(s._nr)return s._nr;
  const nummern=s[6]?s[6].split('|'):[];
  const lage=s[7]||[];
  let la=s[4],lo=s[5];
  s._nr=nummern.map((nr,i)=>{la+=lage[2*i];lo+=lage[2*i+1];return {nr,lat:la/1e5,lon:lo/1e5};});
  return s._nr;
}

// „Musterstr. 12a, 30159 Hannover“ → {strasse, nr, plz, ort}
function adresseZerlegen(text){
  let t=String(text||'').replace(/\s+/g,' ').trim();
  const plzTreffer=t.match(/\b(\d{5})\b/);
  const plz=plzTreffer?plzTreffer[1]:'';
  let teile=t.split(',').map(x=>x.trim()).filter(Boolean);
  let erster=teile[0]||'';
  let rest=teile.slice(1).join(' ');
  // Ohne Komma: „Musterstraße 12 30159 Hannover“
  if(teile.length===1&&plz){
    const i=erster.indexOf(plz);
    rest=erster.slice(i);erster=erster.slice(0,i).trim();
  }
  if(plz&&erster.includes(plz))erster=erster.replace(plz,'').trim();
  // Ohne Komma und ohne PLZ: „Musterstr. 12 Hannover“
  if(teile.length===1&&!plz){
    const o=erster.match(/^(.*[^\d\s].*?\s\d+\s*[a-zA-Z]?)\s+([A-ZÄÖÜ][^\d]*)$/);
    if(o){erster=o[1].trim();rest=o[2].trim();}
  }
  let nr='';
  const m=erster.match(/^(.*?[^\d\s].*?)\s+(\d+\s*[a-zA-Z]?(?:\s*[-–\/]\s*\d+\s*[a-zA-Z]?)?)$/);
  if(m){erster=m[1].trim();nr=m[2].replace(/\s+/g,'');}
  const ort=rest.replace(/\b\d{5}\b/,'').trim();
  return {strasse:erster,nr,plz,ort};
}

// Begriffe, die man statt eines Namens eintippen kann
const ARTEN={
  apotheke:['amenity=pharmacy'],post:['amenity=post_office'],postfiliale:['amenity=post_office'],
  bank:['amenity=bank'],rathaus:['amenity=townhall'],krankenhaus:['amenity=hospital'],klinik:['amenity=hospital','amenity=clinic'],
  arzt:['amenity=doctors'],zahnarzt:['amenity=dentist'],bibliothek:['amenity=library'],buecherei:['amenity=library'],
  polizei:['amenity=police'],tankstelle:['amenity=fuel'],supermarkt:['shop=supermarket'],baecker:['shop=bakery'],
  baeckerei:['shop=bakery'],drogerie:['shop=chemist'],friseur:['shop=hairdresser'],kiosk:['shop=kiosk'],
  schwimmbad:['amenity=swimming_pool','leisure=swimming_pool','leisure=sports_centre'],
  jobcenter:['office=employment_agency','office=government'],amt:['office=government','amenity=townhall'],
  kino:['amenity=cinema'],theater:['amenity=theatre'],cafe:['amenity=cafe'],restaurant:['amenity=restaurant'],
  zoo:['tourism=zoo'],museum:['tourism=museum'],markt:['amenity=marketplace'],
  briefkasten:['amenity=post_box'],tierarzt:['amenity=veterinary'],pflegeheim:['amenity=nursing_home'],
  kindergarten:['amenity=kindergarten'],kita:['amenity=kindergarten'],schule:['amenity=school'],
  kirche:['amenity=place_of_worship'],physiotherapie:['healthcare=physiotherapist'],
  sanitaetshaus:['shop=medical_supply'],optiker:['shop=optician'],hoerakustiker:['shop=hearing_aids']
};

// ---------------------------------------------------------------------------
// Tippfehler-tolerante Suche
// ---------------------------------------------------------------------------
// Buchstaben, die gleich oder ähnlich klingen, kosten beim Verwechseln nur wenig
// (geweken ↔ geveker: w/v klingt gleich).
const AEHNLICH=['vw','fv','fw','ck','kq','cz','sz','dt','bp','gk','iy','ij','ae','ou','mn'];
const aehnlichSet=new Set(AEHNLICH.flatMap(p=>[p,p[1]+p[0]]));
function tippAbstand(a,b,grenze){
  // Damerau-Levenshtein (mit vertauschten Nachbarbuchstaben), gewichtet
  const n=a.length,m=b.length;
  if(Math.abs(n-m)>grenze)return Infinity;
  let vv=new Array(m+1),v=new Array(m+1),w=new Array(m+1);
  for(let j=0;j<=m;j++)v[j]=j;
  for(let i=1;i<=n;i++){
    w[0]=i;let zeileMin=w[0];
    for(let j=1;j<=m;j++){
      const x=a[i-1],y=b[j-1];
      const kosten=x===y?0:aehnlichSet.has(x+y)?0.5:1;
      let d=Math.min(v[j]+1,w[j-1]+1,v[j-1]+kosten);
      if(i>1&&j>1&&x===b[j-2]&&a[i-2]===y)d=Math.min(d,vv[j-2]+1);
      w[j]=d;if(d<zeileMin)zeileMin=d;
    }
    if(zeileMin>grenze)return Infinity;
    const t=vv;vv=v;v=w;w=t;
  }
  return v[m];
}
// Wie viele Tippfehler sind je nach Länge erlaubt?
function erlaubteFehler(laenge){return laenge<5?0:laenge<8?1:laenge<12?2:3}

// Straßen mit ähnlichem Namen („geweken kamp“ → „Geveker Kamp“).
// Liefert die Indexe der Straßen mit dem kleinsten Abstand.
function aehnlicheStrassen(verz,name){
  const grenze=erlaubteFehler(name.length);
  if(!grenze)return null;
  let best=Infinity,namen=[];
  for(const k of verz.namenListe){
    let d=tippAbstand(name,k,grenze);
    // Auch Namensanfang („gevekerk“ → „gevekerkamp“), etwas schlechter bewertet
    if(d===Infinity&&name.length>=6&&k.length>name.length)d=tippAbstand(name,k.slice(0,name.length),grenze)+0.5;
    if(d>grenze)continue;
    if(d<best){best=d;namen=[k];}else if(d===best)namen.push(k);
  }
  if(!namen.length)return null;
  return namen.flatMap(k=>verz.nachName.get(k));
}

function naechster(liste,bezug,lage){
  if(!bezug)return liste[0];
  let beste=null,bd=Infinity;
  for(const x of liste){const [la,lo]=lage(x);const d=abstandM(la,lo,bezug[0],bezug[1]);if(d<bd){bd=d;beste=x;}}
  return beste;
}

// Sucht eine Adresse. bezug = [lat, lon] des vorigen Punktes (für mehrdeutige Namen)
function adresseSuchen(verz,text,bezug){
  const z=adresseZerlegen(text);
  const name=norm(z.strasse);
  const ortN=norm(z.ort);
  if(!name)return null;

  const strassenLage=s=>[s[4]/1e5,s[5]/1e5];
  const passend=liste=>{
    let l=liste.map(i=>verz.strassen[i]);
    if(z.plz){const p=l.filter(s=>s[2]===z.plz);if(p.length)return {l:p,sicher:true};}
    if(ortN){
      const o=l.filter(s=>s[3]>=0&&(verz.ortNorm[s[3]]===ortN||verz.ortNorm[s[3]].startsWith(ortN)||ortN.startsWith(verz.ortNorm[s[3]])));
      if(o.length)return {l:o,sicher:true};
    }
    return {l,sicher:!z.plz&&!ortN};
  };

  // Bekannter Ort (Geschäft, Apotheke, Amt …): Name oder Art.
  // streng: nur genauer Name oder Art („Apotheke“); sonst auch Namensanfang/-teil
  function poiSuchen(streng){
    const textN=norm(text.split(',')[0]);
    const arten=ARTEN[textN];
    if(streng&&!arten&&!verz.pois.some(p=>p[0]===textN))return null;
    const pois=[];
    for(const p of verz.pois){
      if(arten?arten.includes(p[2]):(p[0]===textN||(!streng&&((textN.length>=4&&p[0].startsWith(textN))||(textN.length>=5&&p[0].includes(textN))))))pois.push(p);
    }
    if(!pois.length)return null;
    let nahe=bezug;
    // Ort angegeben: in dessen Nähe suchen (Mittelpunkt der Adressen des Ortes)
    if(ortN){const mitte=ortMitte(verz,ortN);if(mitte)nahe=mitte;}
    const p=naechster(pois,nahe,p=>[p[3]/1e5,p[4]/1e5]);
    const exakt=p[0]===textN;
    const weit=nahe?abstandM(p[3]/1e5,p[4]/1e5,nahe[0],nahe[1])>25000:true;
    return {lat:p[3]/1e5,lon:p[4]/1e5,name:p[1],unsicher:!(exakt||arten)||weit||!nahe};
  }

  // Freie Suche aus mehreren Wörtern: „Kaufland Hannover Mitte“, „Apotheke Linden“.
  // Wörter, die Orte oder Stadtteile sind, bestimmen die Gegend; die übrigen den Namen.
  function freieSuche(){
    const woerter=String(text).split(/[\s,]+/).map(norm).filter(w=>w.length>=2&&!/^\d+$/.test(w));
    if(woerter.length<2)return null;
    const gegend=[],nameW=[];
    for(const w of woerter){
      const pl=verz.platzSuchen(w);
      const istOrt=verz.ortNorm.includes(w);
      if(pl||istOrt)gegend.push({w,pl:pl||[],mitte:istOrt?ortMitte(verz,w):null});
      else nameW.push(w);
    }
    if(!nameW.length)return null;
    // Gegend: der genaueste Ort (Stadtteil vor Stadt), nahe an den übrigen Ortsangaben
    let nahe=bezug,gross=null;
    for(const g of gegend){
      const stadt=g.pl.find(p=>p.stufe<=2);
      if(stadt||g.mitte)gross=gross||(stadt?[stadt.lat,stadt.lon]:g.mitte);
    }
    let genau=null;
    for(const g of gegend)for(const p of g.pl){
      if(gross&&abstandM(p.lat,p.lon,gross[0],gross[1])>20000)continue;
      if(!genau||p.stufe>genau.stufe)genau=p;
    }
    if(genau)nahe=[genau.lat,genau.lon];else if(gross)nahe=gross;
    // Bekannte Orte, deren Name alle Namenswörter enthält (oder deren Art passt)
    const arten=nameW.length===1?ARTEN[nameW[0]]:null;
    let kand=verz.pois.filter(p=>arten?arten.includes(p[2]):nameW.every(w=>p[0].includes(w)));
    let alle=true;
    if(!kand.length&&!arten){
      const laengstes=nameW.slice().sort((a,b)=>b.length-a.length)[0];
      if(laengstes.length>=4){kand=verz.pois.filter(p=>p[0].includes(laengstes));alle=false;}
    }
    if(!kand.length)return null;
    // Namen, die mit dem Gesuchten beginnen, bevorzugen („Marktkauf …“ vor „Apotheke im Marktkauf“),
    // solange einer davon in der Nähe liegt
    const anfang=kand.filter(p=>p[0].startsWith(nameW[0]));
    if(anfang.length&&!arten)kand=anfang;
    const p=naechster(kand,nahe,p=>[p[3]/1e5,p[4]/1e5]);
    // Wie weit darf der Treffer vom genannten Ort entfernt sein?
    // Stadt 8 km, Stadtteil/Dorf 3 km, kleiner Ortsteil 2 km
    const grenze=genau?(genau.stufe<=2?8000:genau.stufe===3?3000:2000):25000;
    const abstand=nahe?abstandM(p[3]/1e5,p[4]/1e5,nahe[0],nahe[1]):Infinity;
    const dort=abstand<=grenze;
    let name=p[1];
    if(genau)name+=dort?' ('+genau.name+')':', '+(abstand/1000).toLocaleString('de-DE',{maximumFractionDigits:0})+' km von '+genau.name+' entfernt';
    return {lat:p[3]/1e5,lon:p[4]/1e5,name,unsicher:!alle||!dort||!nahe};
  }

  // 1. Straße genau gefunden
  let treffer=verz.nachName.get(name);
  let unsicher=false;
  // 2. Ohne Hausnummer: genauer Name eines bekannten Ortes oder Art („Apotheke“)
  if(!treffer&&!z.nr){
    const ort=poiSuchen(true);
    if(ort)return ort;
    // Mehrere Wörter mit Ortsangabe („Kaufland Hannover Mitte“)
    const frei=freieSuche();
    if(frei)return frei;
    // Genau ein Ortsname („Wunstorf“) – vor ähnlichen Straßen („Wunstorfer Straße“)
    if(verz.ortNorm.includes(name)){
      const mitte=ortMitte(verz,name);
      if(mitte)return {lat:mitte[0],lon:mitte[1],name:verz.orte[verz.ortNorm.indexOf(name)],unsicher:true};
    }
    // Stadtteil oder Dorf („Linden“, „Mitte“)
    const pl=verz.platzSuchen(name);
    if(pl&&pl.length){
      const p=naechster(pl,bezug,p=>[p.lat,p.lon]);
      return {lat:p.lat,lon:p.lon,name:p.name,unsicher:true};
    }
  }
  // 3. Straße beginnt mit dem Eingetippten („Engelbosteler“ → „Engelbosteler Damm“)
  if(!treffer&&name.length>=4){
    const kandidaten=[];
    let lo=0,hi=verz.namenListe.length;
    while(lo<hi){const m=(lo+hi)>>1;if(verz.namenListe[m]<name)lo=m+1;else hi=m;}
    for(let i=lo;i<verz.namenListe.length&&verz.namenListe[i].startsWith(name)&&kandidaten.length<400;i++)
      kandidaten.push(...verz.nachName.get(verz.namenListe[i]));
    if(kandidaten.length){treffer=kandidaten;unsicher=true;}
  }
  // 3b. Tippfehler oder Buchstabendreher („geweken kamp“ → „Geveker Kamp“).
  //     Ohne Hausnummer erst, wenn kein bekannter Ort ähnlich heißt.
  if(!treffer){
    const aehnlich=aehnlicheStrassen(verz,name);
    if(aehnlich){
      const ort=z.nr?null:poiSuchen(false);
      if(ort)return ort;
      treffer=aehnlich;unsicher=true;
    }
  }

  if(treffer){
    const {l,sicher}=passend(treffer);
    if(!sicher)unsicher=true;
    // Mehrere gleichnamige Straßen: am liebsten eine mit der Hausnummer, dann die nächste
    let kandidaten=l;
    if(z.nr){
      const mitNr=l.filter(s=>hausnummern(s).some(h=>h.nr.toLowerCase()===z.nr.toLowerCase()));
      if(mitNr.length)kandidaten=mitNr;
    }
    const s=naechster(kandidaten,bezug,strassenLage);
    // Weit auseinander liegende gleichnamige Straßen ohne PLZ/Ort: unsicher
    if(!z.plz&&!ortN&&l.length>1){
      const [la,lo]=strassenLage(s);
      if(l.some(x=>abstandM(la,lo,x[4]/1e5,x[5]/1e5)>8000))unsicher=true;
    }
    const nummern=hausnummern(s);
    const ortName=s[3]>=0?verz.orte[s[3]]:'';
    let lage=null,nrText='';
    if(z.nr&&nummern.length){
      const genau=nummern.find(h=>h.nr.toLowerCase()===z.nr.toLowerCase());
      if(genau){lage=genau;nrText=genau.nr;}
      else{
        // Nächste Hausnummer (gleiche Zahl ohne Buchstabe, sonst numerisch nächste)
        const zahl=parseInt(z.nr,10);
        let bd=Infinity;
        for(const h of nummern){const d=Math.abs(parseInt(h.nr,10)-zahl);if(d<bd){bd=d;lage=h;}}
        nrText=lage?lage.nr:'';
        if(bd>0)unsicher=true;
      }
    }else if(nummern.length){
      // Ohne Hausnummer: Mitte der Straße
      lage=nummern[Math.floor(nummern.length/2)];
      nrText='';
    }else{
      lage={lat:s[4]/1e5,lon:s[5]/1e5};
      if(z.nr)unsicher=true;
    }
    const anzeige=[s[1]+(nrText?' '+nrText:''),ortName].filter(Boolean).join(', ');
    return {lat:lage.lat,lon:lage.lon,name:anzeige,unsicher};
  }

  // 4. Bekannter Ort mit ähnlichem Namen („Marktk“ → „Marktkauf“)
  const ungefaehr=poiSuchen(false);
  if(ungefaehr)return ungefaehr;

  // 5. Nur ein Ort („Langenhagen“)
  const mitte=ortMitte(verz,norm(z.ort||z.strasse));
  if(mitte)return {lat:mitte[0],lon:mitte[1],name:z.ort||z.strasse,unsicher:true};
  return null;
}

function ortMitte(verz,ortN){
  if(!ortN)return null;
  verz._ortMitte=verz._ortMitte||new Map();
  if(verz._ortMitte.has(ortN))return verz._ortMitte.get(ortN);
  let la=0,lo=0,n=0;
  for(const s of verz.strassen){
    if(s[3]>=0&&verz.ortNorm[s[3]]===ortN){la+=s[4];lo+=s[5];n++;}
  }
  const ergebnis=n?[la/n/1e5,lo/n/1e5]:null;
  verz._ortMitte.set(ortN,ergebnis);
  return ergebnis;
}

// ---------------------------------------------------------------------------
// Berechnung über alle Punkte
// ---------------------------------------------------------------------------
// adressen: Texte (Adressen, Orte) oder {lat, lon} für Zwischenpunkte, die
// auf der Karte per Finger gesetzt wurden („über diese Straße gefahren“)
function routeBerechnen(paket,adressen){
  const {netz,verz}=paket;
  const schluessel=a=>typeof a==='string'?a:'@'+a.lat+','+a.lon;
  const gefunden=new Map();
  let bezug=null;
  for(const a of adressen){
    const k=schluessel(a);
    if(gefunden.has(k))continue;
    if(typeof a!=='string'){
      const s=naechsteStrasse(netz,a.lat,a.lon,true);
      if(!s||s.d>1500)throw new Error('An dieser Stelle der Karte ist keine befahrbare Straße.');
      gefunden.set(k,{lat:s.punkt[0],lon:s.punkt[1],name:'Zwischenpunkt',via:true,strasse:s});
      continue;
    }
    const t=adresseSuchen(verz,a,bezug);
    if(!t)throw new Error('Adresse nicht im Kartenpaket gefunden: '+a+'. Bitte Schreibweise prüfen oder die Kilometer von Hand eintragen.');
    const s=naechsteStrasse(netz,t.lat,t.lon);
    if(!s||s.d>3000)throw new Error('Keine befahrbare Straße in der Nähe von: '+a+'.');
    gefunden.set(k,{...t,strasse:s});
    if(!bezug)bezug=[t.lat,t.lon];
  }
  const punkte=adressen.map(a=>gefunden.get(schluessel(a)));
  let meter=0;const linie=[];
  // Abschnitte: wo in der Linie beginnt der Weg zum nächsten Punkt?
  const abschnitte=[];
  for(let i=1;i<punkte.length;i++){
    abschnitte.push(linie.length);
    if(schluessel(adressen[i])===schluessel(adressen[i-1]))continue;
    const r=strecke(netz,punkte[i-1].strasse,punkte[i].strasse);
    if(!r)throw new Error(punkte[i].via||punkte[i-1].via
      ? 'Über diesen Punkt lässt sich keine Strecke fahren (z. B. Einbahnstraße). Bitte den Punkt etwas verschieben.'
      : 'Keine Strecke gefunden zwischen „'+adressen[i-1]+'“ und „'+adressen[i]+'“.');
    meter+=r.meter;
    linie.push(...r.punkte);
  }
  const unsicher=[...gefunden.entries()].filter(([,g])=>g.unsicher).map(([eingabe,g])=>({eingabe,gefunden:g.name}));
  return {
    km:Math.round(meter/100)/10,
    punkte:punkte.map(p=>p.name),
    koordinaten:punkte.map(p=>[p.lat,p.lon]),
    via:punkte.map(p=>Boolean(p.via)),
    abschnitte,
    linie:polylineKodieren(linie),
    unsicher,
    geraet:true
  };
}

// Straßen im Kartenausschnitt (für die Karte ohne fremde Kartenbilder)
function strassenImAusschnitt(netz,[s,w,n,o]){
  const flaeche=(n-s)*(o-w);
  // Je größer der Ausschnitt, desto weniger kleine Straßen
  const maxKlasse=flaeche>0.5?3:flaeche>0.08?5:flaeche>0.01?7:9;
  const linien=[];
  const gesehen=new Set();
  for(let a=Math.floor(s/ZELLE_LAT);a<=Math.floor(n/ZELLE_LAT);a++)
    for(let b=Math.floor(w/ZELLE_LON);b<=Math.floor(o/ZELLE_LON);b++){
      const k=a*100000+b,start=netz.raster.anfang.get(k);
      if(start===undefined)continue;
      const ende=start+netz.raster.anzahl.get(k);
      for(let p=start;p<ende;p++){
        const e=netz.raster.liste[p];
        if(gesehen.has(e))continue;gesehen.add(e);
        const kl=netz.art[e]&15;
        if(kl>maxKlasse)continue;
        linien.push([kl,kantenPunkte(netz,e)]);
        if(linien.length>60000)return linien;
      }
    }
  return linien;
}

// ---------------------------------------------------------------------------
// Kartenbild (Flächen, Flüsse, Bahn, Namen) – nur zum Anzeigen
// ---------------------------------------------------------------------------
function zahlenEntpacken(z){
  const p=[];let la=0,lo=0;
  for(let i=0;i<z.length;i+=2){la+=z[i];lo+=z[i+1];p.push([la/1e5,lo/1e5]);}
  return p;
}
function grenzenVon(z){
  let la=0,lo=0,s=Infinity,n=-Infinity,w=Infinity,o=-Infinity;
  for(let i=0;i<z.length;i+=2){la+=z[i];lo+=z[i+1];if(la<s)s=la;if(la>n)n=la;if(lo<w)w=lo;if(lo>o)o=lo;}
  return [s/1e5,w/1e5,n/1e5,o/1e5];
}
function kartenbildLesen(text){
  const d=JSON.parse(text);
  // Nur die Grenzen vorab berechnen; Punkte erst beim Zeichnen entpacken (spart Speicher)
  d.flaechen.forEach(f=>{f.g=grenzenVon(f[1][0]);});
  d.linien.forEach(l=>{l.g=grenzenVon(l[1]);});
  return d;
}
const ueberlappt=(g,[s,w,n,o])=>!(g[2]<s||g[0]>n||g[3]<w||g[1]>o);

function kartenbildImAusschnitt(bild,grenzen){
  const [s,w,n,o]=grenzen;
  const hoehe=n-s;
  // Kleine Flächen erst bei näherem Hinsehen
  const mindest=hoehe/250;
  const flaechen=[];
  for(const f of bild.flaechen){
    if(!ueberlappt(f.g,grenzen))continue;
    if(Math.max(f.g[2]-f.g[0],(f.g[3]-f.g[1])*0.6)<mindest)continue;
    flaechen.push([f[0],f[1].map(zahlenEntpacken)]);
    if(flaechen.length>12000)break;
  }
  const linien=[];
  for(const l of bild.linien){
    if(l[0]===2&&hoehe>0.08)continue;      // Bäche nur bei nahem Blick
    if(!ueberlappt(l.g,grenzen))continue;
    linien.push([l[0],zahlenEntpacken(l[1])]);
  }
  const drinnen=(la,lo)=>la>=s&&la<=n&&lo>=w&&lo<=o;
  const maxStufe=hoehe>0.5?2:hoehe>0.15?3:hoehe>0.05?4:5;
  const orte=bild.orte.filter(x=>x[0]<=maxStufe&&drinnen(x[2]/1e5,x[3]/1e5))
    .slice(0,80).map(x=>[x[0],x[1],x[2]/1e5,x[3]/1e5]);
  const maxKlasse=hoehe>0.12?0:hoehe>0.05?3:hoehe>0.025?5:7;
  const namen=bild.namen.filter(x=>x[0]<=maxKlasse&&drinnen(x[2]/1e5,x[3]/1e5))
    .slice(0,160).map(x=>[x[0],x[1],x[2]/1e5,x[3]/1e5]);
  return {flaechen,linien,orte,namen};
}

async function kartenbildOeffnen(name){
  const paket=await paketOeffnen(name);
  if(paket.bild!==undefined)return paket.bild;
  paket.bild=null;
  const c=await caches.open(SPEICHER);
  const liste=await c.match(ORDNER+'pakete.json');
  const p=liste&&((await liste.json()).pakete||[]).find(x=>x.name===name);
  const datei=p&&p.dateien&&p.dateien.karte;
  const antwort=datei&&await c.match(ORDNER+datei);
  if(antwort)paket.bild=kartenbildLesen(new TextDecoder().decode(await entpacken(await antwort.arrayBuffer())));
  return paket.bild;
}

// ---------------------------------------------------------------------------
// Pakete laden, speichern, löschen
// ---------------------------------------------------------------------------
const geladen=new Map(); // name → {netz, verz}

async function paketListe(){
  const antwort=await fetch(ORDNER+'pakete.json',{cache:'no-cache'}).catch(()=>null);
  if(antwort&&antwort.ok)return (await antwort.json()).pakete||[];
  // Ohne Internet: gespeicherte Liste
  const c=await caches.open(SPEICHER);
  const alt=await c.match(ORDNER+'pakete.json');
  return alt?((await alt.json()).pakete||[]):[];
}

async function status(){
  const c=await caches.open(SPEICHER);
  let liste=[];
  try{liste=await paketListe();}catch(e){liste=[];}
  const ergebnis=[];
  for(const p of liste){
    const gespeichert=await c.match(ORDNER+p.dateien.strassen)&&await c.match(ORDNER+p.dateien.adressen);
    let stand=null,gebaut='',vollstaendig=true;
    if(gespeichert){
      const info=await c.match(ORDNER+p.name+'.info');
      if(info){const i=await info.json();stand=i.stand;gebaut=i.gebaut||i.stand||'';}
      // Fehlt ein Teil (z. B. das Kartenbild aus einer früheren Fassung), gilt das Paket als veraltet
      for(const d of Object.values(p.dateien)){
        if(!(await c.match(ORDNER+d))){vollstaendig=false;break;}
      }
    }
    const neuer=Boolean(gespeichert)&&(!vollstaendig||String(p.gebaut||p.stand)>String(gebaut));
    ergebnis.push({...p,gespeichert:Boolean(gespeichert),gespeichertStand:stand,neuer});
  }
  return ergebnis;
}

async function herunterladen(name,melden){
  const liste=await paketListe();
  const p=liste.find(x=>x.name===name);
  if(!p)throw new Error('Kartenpaket nicht gefunden.');
  const c=await caches.open(SPEICHER);
  let fertig=0;
  for(const datei of Object.values(p.dateien)){
    const antwort=await fetch(ORDNER+datei,{cache:'no-store'});
    if(!antwort.ok)throw new Error('Herunterladen fehlgeschlagen (Status '+antwort.status+').');
    const leser=antwort.body.getReader();
    const teile=[];
    for(;;){
      const {done,value}=await leser.read();
      if(done)break;
      teile.push(value);fertig+=value.length;
      melden(Math.min(99,Math.round(fertig/p.bytes*100)));
    }
    await c.put(ORDNER+datei,new Response(new Blob(teile),{headers:{'Content-Type':'application/octet-stream'}}));
  }
  await c.put(ORDNER+p.name+'.info',new Response(JSON.stringify({stand:p.stand,gebaut:p.gebaut||p.stand,titel:p.titel}),{headers:{'Content-Type':'application/json'}}));
  await c.put(ORDNER+'pakete.json',new Response(JSON.stringify({pakete:liste}),{headers:{'Content-Type':'application/json'}}));
  geladen.delete(name);
  melden(100);
  return true;
}

async function loeschen(name){
  const c=await caches.open(SPEICHER);
  for(const anfrage of await c.keys()){
    const pfad=new URL(anfrage.url).pathname;
    if(pfad.includes('/karten/'+name+'-')||pfad.endsWith('/karten/'+name+'.info'))await c.delete(anfrage);
  }
  geladen.delete(name);
  return true;
}

async function paketOeffnen(name){
  if(geladen.has(name))return geladen.get(name);
  const c=await caches.open(SPEICHER);
  const liste=await c.match(ORDNER+'pakete.json');
  const p=liste&&((await liste.json()).pakete||[]).find(x=>x.name===name);
  if(!p)throw new Error('Das Kartenpaket ist auf diesem Gerät nicht gespeichert (Einstellungen → Dieses Gerät).');
  const s=await c.match(ORDNER+p.dateien.strassen);
  const a=await c.match(ORDNER+p.dateien.adressen);
  if(!s||!a)throw new Error('Das Kartenpaket ist auf diesem Gerät nicht vollständig. Bitte neu herunterladen.');
  const netz=netzLesen(await entpacken(await s.arrayBuffer()));
  const verz=adressenLesen(new TextDecoder().decode(await entpacken(await a.arrayBuffer())));
  const paket={netz,verz};
  geladen.set(name,paket);
  return paket;
}

// ---------------------------------------------------------------------------
// Nachrichten
// ---------------------------------------------------------------------------
if(typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope){
  self.onmessage=async e=>{
    const {nr,typ}=e.data||{};
    const antworten=(ok,inhalt)=>self.postMessage(ok?{nr,ok:true,ergebnis:inhalt}:{nr,ok:false,fehler:inhalt});
    try{
      if(typ==='status')return antworten(true,await status());
      if(typ==='herunterladen')return antworten(true,await herunterladen(e.data.paket,f=>self.postMessage({nr,fortschritt:f})));
      if(typ==='loeschen')return antworten(true,await loeschen(e.data.paket));
      if(typ==='route'){
        const paket=await paketOeffnen(e.data.paket);
        return antworten(true,routeBerechnen(paket,e.data.adressen));
      }
      if(typ==='strassen'){
        const paket=await paketOeffnen(e.data.paket);
        return antworten(true,strassenImAusschnitt(paket.netz,e.data.grenzen));
      }
      if(typ==='karte'){
        // Straßen und – falls vorhanden – Flächen, Flüsse, Bahn und Namen im Ausschnitt
        const paket=await paketOeffnen(e.data.paket);
        const bild=await kartenbildOeffnen(e.data.paket).catch(()=>null);
        const ergebnis=bild?kartenbildImAusschnitt(bild,e.data.grenzen):{flaechen:[],linien:[],orte:[],namen:[]};
        ergebnis.strassen=strassenImAusschnitt(paket.netz,e.data.grenzen);
        return antworten(true,ergebnis);
      }
      antworten(false,'Unbekannter Auftrag.');
    }catch(fehler){
      antworten(false,(fehler&&fehler.message)||String(fehler));
    }
  };
}

// Für Tests außerhalb des Browsers (node)
if(typeof module!=='undefined')module.exports={kartenbildLesen,kartenbildImAusschnitt,norm,netzLesen,adressenLesen,adresseZerlegen,adresseSuchen,naechsteStrasse,strecke,routeBerechnen,entpacken,strassenImAusschnitt};
