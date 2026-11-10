#!/usr/bin/env python3
"""
Kartenpaket bauen – für die Kilometer-Berechnung direkt auf dem Gerät.

Was dieses Programm macht (läuft NICHT in der App, sondern einmalig beim
Erstellen eines Pakets, z. B. alle paar Monate):

1. Liest OpenStreetMap-Daten (Datei *.osm.pbf, z. B. von download.geofabrik.de).
2. Sucht alle Straßen, die man mit dem Auto befahren darf, und baut daraus
   ein Straßennetz (Kreuzungen und Straßenstücke mit Länge und Tempo).
3. Sammelt alle Adressen (Straße, Hausnummer, PLZ, Ort) mit ihrer Lage und
   bekannte Orte wie Apotheken, Supermärkte, Banken und Ämter.
4. Schreibt zwei gepackte Dateien und trägt das Paket in pakete.json ein:
     karten/<name>-strassen.bin.gz   Straßennetz
     karten/<name>-adressen.json.gz  Adressverzeichnis

Die App lädt diese Dateien einmal von der eigenen Adresse herunter und
rechnet danach alles auf dem Gerät. Keine Adresse verlässt das Gerät.

Aufruf:
  pip install osmium numpy
  python3 bauen.py --name niedersachsen --titel "Niedersachsen und Bremen" \
      niedersachsen-latest.osm.pbf bremen-latest.osm.pbf

Kartendaten: © OpenStreetMap-Mitwirkende, Lizenz ODbL
(https://www.openstreetmap.org/copyright).
"""

import argparse
import datetime
import gzip
import json
import math
import os
import re
import struct
from array import array

import numpy as np

import osmium

# ---------------------------------------------------------------------------
# Straßenarten, die mit dem Auto befahren werden dürfen, und übliches Tempo
# (km/h), wenn kein Tempolimit eingetragen ist. Die Klasse (Zahl) nutzt die
# App für Abbiege-Zuschläge und für das Zeichnen der Karte.
# ---------------------------------------------------------------------------
STRASSEN = {
    #  Art              Klasse  Tempo
    'motorway':        (1, 120),
    'motorway_link':   (1, 60),
    'trunk':           (2, 90),
    'trunk_link':      (2, 50),
    'primary':         (3, 65),
    'primary_link':    (3, 45),
    'secondary':       (4, 60),
    'secondary_link':  (4, 40),
    'tertiary':        (5, 50),
    'tertiary_link':   (5, 35),
    'unclassified':    (6, 40),
    'residential':     (7, 30),
    'living_street':   (8, 7),
    'service':         (9, 15),
}
# Innerorts gelten niedrigere Werte (Straßen mit Namen und ohne Tempo-Angabe
# in Wohngebieten werden über die Klasse erfasst).
VERBOTEN = {'no', 'private', 'agricultural', 'forestry', 'delivery', 'emergency'}
SERVICE_WEG = {'parking_aisle', 'drive-through', 'emergency_access'}

# Bekannte Orte, die man als Stopp ohne Adresse eintippen kann
POI_SCHLUESSEL = {
    'amenity': {'pharmacy', 'bank', 'post_office', 'townhall', 'hospital', 'doctors',
                'clinic', 'dentist', 'library', 'police', 'courthouse', 'social_facility',
                'community_centre', 'fuel', 'kindergarten', 'school', 'place_of_worship',
                'cafe', 'restaurant', 'fast_food', 'cinema', 'theatre', 'marketplace',
                'post_box', 'swimming_pool', 'nursing_home', 'veterinary'},
    'shop': None,      # alle Geschäfte
    'office': {'government', 'employment_agency', 'insurance', 'lawyer', 'social'},
    'healthcare': None,
    'leisure': {'sports_centre', 'swimming_pool', 'park', 'fitness_centre'},
    'tourism': {'museum', 'zoo', 'attraction', 'hotel'},
}


def tempo_aus_tag(wert):
    """'50' → 50, '30 mph' → 48, 'DE:urban' → 50, sonst None."""
    if not wert:
        return None
    wert = wert.strip().lower()
    feste = {'de:urban': 50, 'de:rural': 100, 'de:motorway': 130, 'de:living_street': 7,
             'de:zone30': 30, 'de:zone:30': 30, 'walk': 7, 'none': 130, 'signals': None}
    if wert in feste:
        return feste[wert]
    m = re.match(r'^(\d+(?:\.\d+)?)\s*(mph)?', wert)
    if not m:
        return None
    zahl = float(m.group(1))
    if m.group(2):
        zahl *= 1.609
    return int(round(zahl)) if 3 <= zahl <= 150 else None


def einbahn(tags):
    """1 = nur vorwärts, -1 = nur rückwärts, 0 = beide Richtungen."""
    w = tags.get('oneway', '')
    if w in ('yes', '1', 'true'):
        return 1
    if w in ('-1', 'reverse'):
        return -1
    if w == 'no':
        return 0
    if tags.get('junction') in ('roundabout', 'circular'):
        return 1
    if tags.get('highway') in ('motorway', 'motorway_link'):
        return 1
    return 0


def befahrbar(tags):
    art = tags.get('highway')
    if art not in STRASSEN:
        return False
    if tags.get('area') == 'yes':
        return False
    for schluessel in ('motor_vehicle', 'motorcar', 'vehicle', 'access'):
        w = tags.get(schluessel)
        if w is None:
            continue
        # Die genaueste Angabe entscheidet (motor_vehicle vor access)
        if w in VERBOTEN:
            return False
        break
    if art == 'service' and tags.get('service') in SERVICE_WEG:
        return False
    return True


def normalisieren(text):
    """Vereinheitlicht Straßen- und Ortsnamen für die Suche.
    Muss genau so in der App (km-geraet.js, Funktion norm) umgesetzt sein."""
    t = text.lower()
    t = t.replace('ß', 'ss').replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue')
    t = re.sub(r'str(asse|\.|\b)', 'str', t)
    t = re.sub(r'[^a-z0-9]', '', t)
    return t


def abstand_m(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def vereinfachen(punkte, toleranz_m=4.0):
    """Douglas-Peucker: unnötige Zwischenpunkte weglassen (nur für Lage und
    Karte – die Länge wird vorher aus allen Punkten berechnet)."""
    if len(punkte) <= 2:
        return punkte
    lat0 = math.radians(punkte[0][0])
    kx = 111320.0 * math.cos(lat0)
    ky = 110540.0

    def entfernung(p, a, b):
        ax, ay = a[1] * kx, a[0] * ky
        bx, by = b[1] * kx, b[0] * ky
        px, py = p[1] * kx, p[0] * ky
        dx, dy = bx - ax, by - ay
        lang = dx * dx + dy * dy
        if lang == 0:
            return math.hypot(px - ax, py - ay)
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / lang))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

    behalten = [False] * len(punkte)
    behalten[0] = behalten[-1] = True
    stapel = [(0, len(punkte) - 1)]
    while stapel:
        i, j = stapel.pop()
        groesste, idx = 0, -1
        for k in range(i + 1, j):
            d = entfernung(punkte[k], punkte[i], punkte[j])
            if d > groesste:
                groesste, idx = d, k
        if groesste > toleranz_m and idx > 0:
            behalten[idx] = True
            stapel.append((i, idx))
            stapel.append((idx, j))
    return [p for p, b in zip(punkte, behalten) if b]


class Leser(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.wege = []            # (osm-Knoten-IDs, (Breiten, Längen), klasse, tempo, einbahn)
        self.alle_refs = array('q')  # alle Knoten-IDs der Straßen (Enden doppelt)
        self.gesehen = set()      # schon gelesene Wege/Punkte (Grenzgebiet steckt in zwei Dateien)
        self.adressen = []        # (strasse, hausnummer, plz, ort, lat, lon)
        self.pois = []            # (name, art, lat, lon)
        self.strassen_namen = []  # (name, lat, lon) – Mittelpunkte benannter Straßen

    # Adressen und Orte auf einzelnen Punkten
    def node(self, n):
        tags = n.tags
        if not n.location.valid() or not len(tags):
            return
        if ('n', n.id) in self.gesehen:
            return
        if 'addr:housenumber' in tags or 'name' in tags:
            self.gesehen.add(('n', n.id))
        if 'addr:housenumber' in tags and ('addr:street' in tags or 'addr:place' in tags):
            self._adresse(tags, n.location.lat, n.location.lon)
        name = tags.get('name')
        if name:
            art = self._poi_art(tags)
            if art:
                self.pois.append((name, art, n.location.lat, n.location.lon))

    def way(self, w):
        tags = w.tags
        if w.id in self.gesehen:
            return
        hat_adresse = 'addr:housenumber' in tags and ('addr:street' in tags or 'addr:place' in tags)
        name = tags.get('name')
        poi_art = self._poi_art(tags) if name else None

        if befahrbar(tags):
            self.gesehen.add(w.id)
            # Platzsparend: Knoten-IDs und Lage (Grad × 1e7) als Zahlenreihen
            ids, lats, lons = array('q'), array('i'), array('i')
            for nd in w.nodes:
                if not nd.location.valid():
                    return
                ids.append(nd.ref)
                lats.append(nd.location.y)
                lons.append(nd.location.x)
            if len(ids) < 2:
                return
            punkte = (lats, lons)
            art = tags['highway']
            klasse, tempo = STRASSEN[art]
            angabe = tempo_aus_tag(tags.get('maxspeed'))
            if angabe:
                # Tatsächlich fährt man meist etwas langsamer als erlaubt
                tempo = min(angabe, 130) * (0.85 if klasse <= 2 else 0.9)
            richtung = einbahn(tags)
            self.wege.append((ids, punkte, klasse, tempo, richtung))
            # Anfang und Ende zählen doppelt, damit sie immer Kreuzungen werden
            self.alle_refs.extend(ids)
            self.alle_refs.append(ids[0])
            self.alle_refs.append(ids[-1])
            if name:
                m = len(ids) // 2
                self.strassen_namen.append((name, lats[m] / 1e7, lons[m] / 1e7))
            return

        if hat_adresse or poi_art:
            self.gesehen.add(w.id)
            lat = lon = 0.0
            anzahl = 0
            for nd in w.nodes:
                if nd.location.valid():
                    lat += nd.location.lat
                    lon += nd.location.lon
                    anzahl += 1
            if not anzahl:
                return
            lat /= anzahl
            lon /= anzahl
            if hat_adresse:
                self._adresse(tags, lat, lon)
            if poi_art:
                self.pois.append((name, poi_art, lat, lon))

    def _adresse(self, tags, lat, lon):
        strasse = tags.get('addr:street') or tags.get('addr:place')
        nummern = tags.get('addr:housenumber', '')
        plz = tags.get('addr:postcode', '')
        ort = tags.get('addr:city', '') or tags.get('addr:suburb', '')
        # „12;14“ oder „12,14“ → zwei Hausnummern an derselben Stelle
        for nr in re.split(r'[;,]', nummern):
            nr = nr.strip()
            if nr and len(nr) <= 12:
                self.adressen.append((strasse, nr, plz, ort, lat, lon))

    @staticmethod
    def _poi_art(tags):
        for schluessel, werte in POI_SCHLUESSEL.items():
            w = tags.get(schluessel)
            if w and (werte is None or w in werte):
                return schluessel + '=' + w
        return None


def netz_bauen_und_schreiben(leser, pfad):
    """Teilt Straßen an Kreuzungen in Stücke, behält nur das größte
    zusammenhängende Netz und schreibt es als Binärdatei (gzip).

    Format (little-endian):
      'QAKM', Version (uint32), N Knoten, E Kanten, G Zwischenpunkte
      knotenLat int32[N], knotenLon int32[N]      (Grad × 1e6)
      kanteVon uint32[E], kanteNach uint32[E]
      kanteLaenge uint32[E]                       (Dezimeter)
      kanteTempo uint8[E]                         (km/h)
      kanteArt uint8[E]                           (Klasse | 16 = nur vorwärts | 32 = nur rückwärts)
      Füllbytes bis zur nächsten 4-Byte-Grenze
      zwischenAnfang uint32[E+1]
      zwischenLat int32[G], zwischenLon int32[G]
    Die Nachbarliste baut die App beim Laden selbst."""
    refs = np.frombuffer(leser.alle_refs, dtype=np.int64)
    ids, anzahl = np.unique(refs, return_counts=True)
    kreuzung = ids[anzahl >= 2]          # sortiert → Position = Knotennummer
    leser.alle_refs = None
    del refs, ids, anzahl
    K = len(kreuzung)
    k_lat = np.zeros(K, dtype=np.int32)
    k_lon = np.zeros(K, dtype=np.int32)

    e_von, e_nach, e_laenge = array('I'), array('I'), array('I')
    e_tempo, e_art = array('B'), array('B')
    zw_anfang, zw_lat, zw_lon = array('I', [0]), array('i'), array('i')

    wege = leser.wege
    leser.wege = None
    while wege:
        refs, (lats, lons), klasse, tempo, richtung = wege.pop()
        r = np.frombuffer(refs, dtype=np.int64)
        pos = np.searchsorted(kreuzung, r)
        pos_c = np.minimum(pos, K - 1)
        ist_k = kreuzung[pos_c] == r
        punkte = [(la / 1e7, lo / 1e7) for la, lo in zip(lats, lons)]
        art = klasse | (16 if richtung == 1 else 32 if richtung == -1 else 0)
        tempo_b = max(5, min(255, int(round(tempo))))
        stellen = np.nonzero(ist_k)[0]
        for i in range(1, len(stellen)):
            a, b = int(stellen[i - 1]), int(stellen[i])
            laenge = 0.0
            for k in range(a + 1, b + 1):
                laenge += abstand_m(punkte[k - 1][0], punkte[k - 1][1], punkte[k][0], punkte[k][1])
            von, nach = int(pos[a]), int(pos[b])
            if von == nach and laenge <= 1:
                continue
            k_lat[von] = int(round(punkte[a][0] * 1e6)); k_lon[von] = int(round(punkte[a][1] * 1e6))
            k_lat[nach] = int(round(punkte[b][0] * 1e6)); k_lon[nach] = int(round(punkte[b][1] * 1e6))
            e_von.append(von); e_nach.append(nach)
            e_laenge.append(max(1, int(round(laenge * 10))))
            e_tempo.append(tempo_b); e_art.append(art)
            for p in vereinfachen(punkte[a:b + 1])[1:-1]:
                zw_lat.append(int(round(p[0] * 1e6)))
                zw_lon.append(int(round(p[1] * 1e6)))
            zw_anfang.append(len(zw_lat))

    von = np.frombuffer(e_von, dtype=np.uint32).astype(np.int64)
    nach = np.frombuffer(e_nach, dtype=np.uint32).astype(np.int64)

    # Größtes zusammenhängendes Netz (Union-Find mit numpy-Hilfe)
    eltern = np.arange(K, dtype=np.int64)
    def wurzel(x):
        w = x
        while eltern[w] != w:
            w = eltern[w]
        while eltern[x] != w:
            eltern[x], x = w, eltern[x]
        return w
    for a, b in zip(von.tolist(), nach.tolist()):
        ra, rb = wurzel(a), wurzel(b)
        if ra != rb:
            eltern[ra] = rb
    for i in range(K):
        eltern[i] = wurzel(i)
    werte, zahl = np.unique(eltern, return_counts=True)
    haupt = werte[np.argmax(zahl)]
    behalten = eltern == haupt
    # Kreuzungen ohne Kante (nur Durchgangspunkt einer verworfenen Schleife) fallen ebenfalls weg
    benutzt = np.zeros(K, dtype=bool); benutzt[von] = True; benutzt[nach] = True
    behalten &= benutzt

    # Knoten räumlich sortieren (bessere Packung, schnellere Suche in der App)
    alte = np.nonzero(behalten)[0]
    reihenfolge = np.lexsort((k_lon[alte], k_lat[alte] // 20000))
    alte = alte[reihenfolge]
    neu = np.full(K, -1, dtype=np.int64)
    neu[alte] = np.arange(len(alte))

    kante_ok = behalten[von]
    zw_a = np.frombuffer(zw_anfang, dtype=np.uint32).astype(np.int64)
    zl = np.frombuffer(zw_lat, dtype=np.int32)
    zo = np.frombuffer(zw_lon, dtype=np.int32)
    zw_laenge = np.diff(zw_a)
    zw_maske = np.repeat(kante_ok, zw_laenge)

    N = len(alte)
    E = int(kante_ok.sum())
    G = int(zw_maske.sum())
    neue_anfaenge = np.concatenate(([0], np.cumsum(zw_laenge[kante_ok]))).astype('<u4')
    with gzip.open(pfad, 'wb', compresslevel=9) as f:
        f.write(b'QAKM' + struct.pack('<IIII', 1, N, E, G))
        f.write(k_lat[alte].astype('<i4').tobytes())
        f.write(k_lon[alte].astype('<i4').tobytes())
        f.write(neu[von[kante_ok]].astype('<u4').tobytes())
        f.write(neu[nach[kante_ok]].astype('<u4').tobytes())
        f.write(np.frombuffer(e_laenge, dtype=np.uint32)[kante_ok].astype('<u4').tobytes())
        f.write(np.frombuffer(e_tempo, dtype=np.uint8)[kante_ok].tobytes())
        f.write(np.frombuffer(e_art, dtype=np.uint8)[kante_ok].tobytes())
        f.write(b'\0' * ((4 - (2 * E) % 4) % 4))
        f.write(neue_anfaenge.tobytes())
        f.write(zl[zw_maske].astype('<i4').tobytes())
        f.write(zo[zw_maske].astype('<i4').tobytes())
    print(f'  Netz: {N:,} Kreuzungen, {E:,} Straßenstücke, {G:,} Zwischenpunkte '
          f'(entfernt: {K - N:,} Kreuzungen außerhalb des Hauptnetzes)')
    grenzen = [float(k_lat[alte].min()) / 1e6, float(k_lon[alte].min()) / 1e6,
               float(k_lat[alte].max()) / 1e6, float(k_lon[alte].max()) / 1e6]
    return N, E, G, grenzen


def adressen_schreiben(pfad, leser):
    """Adressverzeichnis als JSON (gzip).
    orte:     Liste der Ortsnamen
    strassen: [Suchname, Anzeigename, PLZ, Ort-Nr., Lat0, Lon0, Hausnummern]
              Hausnummern: "12a|14|16" und Lage als Abstände (Grad × 1e5) zum Vorgänger
    pois:     [Suchname, Anzeigename, Art, Lat, Lon]  (Lat/Lon × 1e5)"""
    orte, ort_nr = [], {}
    gruppen = {}
    for strasse, nr, plz, ort, lat, lon in leser.adressen:
        schluessel = (strasse, plz, ort)
        gruppen.setdefault(schluessel, []).append((nr, lat, lon))

    # Ort aus der PLZ ergänzen, wenn er an der Adresse fehlt
    plz_ort = {}
    for (strasse, plz, ort), _ in gruppen.items():
        if plz and ort:
            plz_ort.setdefault(plz, {})
            plz_ort[plz][ort] = plz_ort[plz].get(ort, 0) + 1

    strassen = []
    for (strasse, plz, ort), eintraege in gruppen.items():
        if not ort and plz in plz_ort:
            ort = max(plz_ort[plz], key=plz_ort[plz].get)
        if ort not in ort_nr:
            ort_nr[ort] = len(orte)
            orte.append(ort)
        # Nach Hausnummer sortieren (12 < 12a < 13), doppelte entfernen
        def sortier(e):
            m = re.match(r'(\d+)(.*)', e[0])
            return (int(m.group(1)), m.group(2)) if m else (10 ** 9, e[0])
        gesehen = set()
        liste = []
        for e in sorted(eintraege, key=sortier):
            if e[0].lower() in gesehen:
                continue
            gesehen.add(e[0].lower())
            liste.append(e)
        lat0 = int(round(liste[0][1] * 1e5))
        lon0 = int(round(liste[0][2] * 1e5))
        nummern = '|'.join(e[0] for e in liste)
        lage = []
        vor_lat, vor_lon = lat0, lon0
        for e in liste:
            la, lo = int(round(e[1] * 1e5)), int(round(e[2] * 1e5))
            lage.extend((la - vor_lat, lo - vor_lon))
            vor_lat, vor_lon = la, lo
        strassen.append([normalisieren(strasse), strasse, plz, ort_nr[ort], lat0, lon0, nummern, lage])

    # Benannte Straßen ohne eingetragene Hausnummern (Mittelpunkt) als Rückfall
    bekannt = {s[0] for s in strassen}
    ohne = {}
    for name, lat, lon in leser.strassen_namen:
        n = normalisieren(name)
        if n in bekannt:
            continue
        ohne.setdefault(n, []).append((name, lat, lon))
    for n, liste in ohne.items():
        # Gleichnamige Straßen in verschiedenen Orten: grob nach Lage trennen (~5 km)
        zellen = {}
        for name, lat, lon in liste:
            zellen.setdefault((round(lat * 20), round(lon * 12)), []).append((name, lat, lon))
        for teile in zellen.values():
            name, lat, lon = teile[len(teile) // 2]
            strassen.append([n, name, '', -1, int(round(lat * 1e5)), int(round(lon * 1e5)), '', []])

    pois = []
    for name, art, lat, lon in leser.pois:
        pois.append([normalisieren(name), name, art, int(round(lat * 1e5)), int(round(lon * 1e5))])

    daten = {'orte': orte, 'strassen': strassen, 'pois': pois}
    with gzip.open(pfad, 'wt', encoding='utf-8', compresslevel=9) as f:
        json.dump(daten, f, ensure_ascii=False, separators=(',', ':'))
    print(f'  Adressen: {len(leser.adressen):,} Hausnummern in {len(strassen):,} Straßen, '
          f'{len(pois):,} bekannte Orte, {len(orte):,} Orte')


def main():
    p = argparse.ArgumentParser(description='Kartenpaket für die Kilometer-Berechnung bauen')
    p.add_argument('dateien', nargs='+', help='OpenStreetMap-Dateien (*.osm.pbf)')
    p.add_argument('--name', required=True, help='kurzer Name, z. B. niedersachsen')
    p.add_argument('--titel', required=True, help='Anzeigename, z. B. "Niedersachsen und Bremen"')
    p.add_argument('--ziel', default=os.path.join(os.path.dirname(__file__), '..', '..', 'karten'))
    a = p.parse_args()

    os.makedirs(a.ziel, exist_ok=True)
    leser = Leser()
    for datei in a.dateien:
        print('Lese', datei, '…')
        leser.apply_file(datei, locations=True, idx='flex_mem')

    leser.gesehen = None
    print('Baue Straßennetz …')
    netz_datei = f'{a.name}-strassen.bin.gz'
    N, E, G, grenzen = netz_bauen_und_schreiben(leser, os.path.join(a.ziel, netz_datei))

    print('Schreibe Adressverzeichnis …')
    adr_datei = f'{a.name}-adressen.json.gz'
    adressen_schreiben(os.path.join(a.ziel, adr_datei), leser)

    groesse = lambda d: os.path.getsize(os.path.join(a.ziel, d))
    eintrag = {
        'name': a.name,
        'titel': a.titel,
        'stand': datetime.date.today().isoformat(),
        'version': 1,
        'dateien': {'strassen': netz_datei, 'adressen': adr_datei},
        'bytes': groesse(netz_datei) + groesse(adr_datei),
        'grenzen': grenzen,
        'quelle': '© OpenStreetMap-Mitwirkende (ODbL)'
    }
    liste_pfad = os.path.join(a.ziel, 'pakete.json')
    pakete = []
    if os.path.exists(liste_pfad):
        with open(liste_pfad, encoding='utf-8') as f:
            pakete = [x for x in json.load(f).get('pakete', []) if x.get('name') != a.name]
    pakete.append(eintrag)
    pakete.sort(key=lambda x: x['titel'])
    with open(liste_pfad, 'w', encoding='utf-8') as f:
        json.dump({'pakete': pakete}, f, ensure_ascii=False, indent=2)
    print(f'Fertig: {eintrag["bytes"] / 1e6:.1f} MB ({N:,} Knoten, {E:,} Kanten, {G:,} Zwischenpunkte)')


if __name__ == '__main__':
    main()
