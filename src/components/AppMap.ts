import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.webpack.css';
import 'leaflet-defaulticon-compatibility';
import 'leaflet-sidebar-v2';
import 'leaflet-sidebar-v2/css/leaflet-sidebar.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import '@/util/leaflet_tile_workaround.js';

import * as L from 'leaflet';
import debounce from 'lodash/debounce';
import Component, { mixins } from 'vue-class-component';
import VueRouter from 'vue-router';
import draggable from 'vuedraggable';

import AppMapDetailsDungeon from '@/components/AppMapDetailsDungeon';
import AppMapDetailsObj from '@/components/AppMapDetailsObj';
import AppMapDetailsPlace from '@/components/AppMapDetailsPlace';
import AppMapFilterMainButton from '@/components/AppMapFilterMainButton';
import AppMapPopup from '@/components/AppMapPopup';
import AppMapSettings from '@/components/AppMapSettings';
import MixinUtil from '@/components/MixinUtil';
import ModalGotoCoords from '@/components/ModalGotoCoords';
import ObjectInfo from '@/components/ObjectInfo';
import { MsgMgr } from '@/services/MsgMgr';
import {
  MapBase,
  SHOW_ALL_OBJS_FOR_MAP_UNIT_EVENT,
} from '@/MapBase';
import * as MapIcons from '@/MapIcon';
import * as MapMarkers from '@/MapMarker';
import {
  MapMarker,
  SearchResultUpdateMode,
} from '@/MapMarker';
import { MapMarkerGroup } from '@/MapMarkerGroup';
import {
  SEARCH_PRESETS,
  SearchExcludeSet,
  SearchResultGroup,
} from '@/MapSearch';
import * as save from '@/save';
import {
  MapMgr,
  ObjectData,
  ObjectMinData,
} from '@/services/MapMgr';
import * as map from '@/util/map';
import { Point } from '@/util/map';
import { calcLayerLength } from '@/util/polyline';
import { Settings } from '@/util/settings';
import * as ui from '@/util/ui';

const { isNavigationFailure, NavigationFailureType } = VueRouter;

interface ObjectIdentifier {
  mapType: string;
  mapName: string;
  hashId: string;
}

function valueOrDefault<T>(value: T | undefined, defaultValue: T) {
  return value === undefined ? defaultValue : value;
}

interface MarkerComponent {
  cl: any;
  detailsComponent?: string;
  preloadPad?: number;
  enableUpdates?: boolean;

  filterIcon: string,
  filterLabel: string,
}

const MARKER_COMPONENTS: { [type: string]: MarkerComponent } = Object.freeze({
  'Location': {
    cl: MapMarkers.MapMarkerLocation,
    preloadPad: 0.6,
    filterIcon: MapIcons.CHECKPOINT.options.iconUrl,
    filterLabel: 'Locations',
  },
  'Dungeon': {
    cl: MapMarkers.MapMarkerDungeon,
    detailsComponent: 'AppMapDetailsDungeon',
    enableUpdates: true,
    filterIcon: MapIcons.TOTK_SHRINE.options.iconUrl,
    filterLabel: 'Shrines',
  },
  'Place': {
    cl: MapMarkers.MapMarkerPlace,
    detailsComponent: 'AppMapDetailsPlace',
    enableUpdates: true,
    filterIcon: MapIcons.VILLAGE.options.iconUrl,
    filterLabel: 'Places',
  },
  'Tower': {
    cl: MapMarkers.MapMarkerTower,
    enableUpdates: true,
    filterIcon: MapIcons.TOTK_TOWER.options.iconUrl,
    filterLabel: 'Towers',
  },
  'Shop': {
    cl: MapMarkers.MapMarkerShop,
    filterIcon: MapIcons.SHOP_YOROZU.options.iconUrl,
    filterLabel: 'Shops',
  },
  'Labo': {
    cl: MapMarkers.MapMarkerLabo,
    enableUpdates: true,
    filterIcon: MapIcons.LABO.options.iconUrl,
    filterLabel: 'Tech Labs',
  },
  'Chasm': {
    cl: MapMarkers.MapMarkerCave,
    filterIcon: MapIcons.CHASM.options.iconUrl,
    filterLabel: 'Chasm',
  },
  'Cave': {
    cl: MapMarkers.MapMarkerCave,
    filterIcon: MapIcons.CAVE.options.iconUrl,
    filterLabel: 'Cave/Well',
  },
  'Korok': {
    cl: MapMarkers.MapMarkerKorok,
    detailsComponent: 'AppMapDetailsObj',
    enableUpdates: true,
    filterIcon: MapIcons.KOROK.options.iconUrl,
    filterLabel: 'Koroks',
  },
  'DragonTears': {
    cl: MapMarkers.MapMarkerTear,
    enableUpdates: true,
    filterIcon: MapIcons.TOTK_TEAR.options.iconUrl,
    filterLabel: 'Dragon Tears',
  },
  'CheckPoint': {
    cl: MapMarkers.MapMarkerLightroot,
    enableUpdates: true,
    filterIcon: MapIcons.TOTK_LIGHTROOT.options.iconUrl,
    filterLabel: 'Lightroots',
  },
  'Dispensers': {
    cl: MapMarkers.MapMarkerDispenser,
    detailsComponent: 'AppMapDetailsObj',
    enableUpdates: true,
    filterIcon: MapIcons.DISPENSER.options.iconUrl,
    filterLabel: 'Device Dispenser',
  },
});

function getMarkerDetailsComponent(marker: MapMarker): string {
  if (marker instanceof MapMarkers.MapMarkerObj || marker instanceof MapMarkers.MapMarkerSearchResult)
    return 'AppMapDetailsObj';

  for (const component of Object.values(MARKER_COMPONENTS)) {
    if (marker instanceof component.cl)
      return valueOrDefault(component.detailsComponent, '');
  }
  return '';
}

class LayerProps {
  title: string;
  text: string;
  pathLength: number;
  order: number;
  constructor() {
    this.title = "";
    this.text = "";
    this.pathLength = 0;
    this.order = -1;
  }
  lengthAsString(): string {
    if (this.pathLength <= 0.0) {
      return "";
    }
    return `${this.pathLength.toFixed(2)} m`;
  }
  tooltip(): string {
    return (this.title || 'Unnamed') + " " + this.lengthAsString();
  }
  fromGeoJSON(feat: any) {
    this.title = feat.properties.title || '';
    this.text = feat.properties.text || '';
    this.pathLength = feat.properties.pathLength || 0;
    this.order = (feat.properties.order !== undefined) ? feat.properties.order : -1;
  }
}
function addGeoJSONFeatureToLayer(layer: any) {
  if (!layer.feature) {
    layer.feature = { type: 'Feature' };
  }
  if (!layer.feature.properties) {
    layer.feature.properties = new LayerProps();
  }
}



function layerSetTooltip(layer: L.Marker | L.Polyline) {
  if (layer.feature) {
    layer.setTooltipContent(layer.feature.properties.tooltip());
  }
}

function layerSetPopup(layer: L.Marker | L.Polyline, popup: AppMapPopup) {
  layer.bindPopup(popup.$el as HTMLElement, { minWidth: 200 });
  // @ts-ignore
  // popup instance is needed later to update the length
  layer.popup = popup;
}

function addPopupAndTooltip(layer: L.Marker | L.Polyline, root: any) {
  if (layer && layer.feature) {
    let popup = new AppMapPopup({ propsData: layer.feature.properties });
    // Initiate the Element as $el
    popup.$mount();
    // Respond to `title` and `text` messages
    popup.$on('title', (txt: string) => {
      if (layer && layer.feature) {
        layer.feature.properties.title = txt;
        layerSetTooltip(layer);
        root.updateDrawLayerOpts({ title: txt, layer });
      }
    });
    popup.$on('text', (txt: string) => {
      if (layer && layer.feature) {
        layer.feature.properties.text = txt;
        root.updateDrawLayerOpts({ txt: txt, layer });
      }
    });
    // Create Popup and Tooltip
    layerSetPopup(layer, popup);
    layer.bindTooltip(layer.feature.properties.tooltip());
  }
}


@Component({
  components: {
    AppMapDetailsDungeon,
    AppMapDetailsObj,
    AppMapDetailsPlace,
    AppMapFilterMainButton,
    AppMapSettings,
    ModalGotoCoords,
    ObjectInfo,
    draggable,
  },
})
export default class AppMap extends mixins(MixinUtil) {
  readonly OBJMAP_VERSION = process.env.VUE_APP_GIT_HASH;

  private map!: MapBase;
  private updatingRoute = false;
  private zoom = map.DEFAULT_ZOOM;

  private sidebar!: L.Control.Sidebar;
  private sidebarActivePane = '';
  private sidebarPaneScrollPos: Map<string, number> = new Map();
  private drawControlEnabled = false;
  private drawControl: any;
  private drawLayer!: L.GeoJSON;
  private drawLayerOpts: any[] = [];
  private drawLineColor = '#3388ff';
  private setLineColorThrottler!: () => void;

  private previousGotoMarker: L.Marker | null = null;
  private greatPlateauBarrierShown = false;

  private detailsComponent = '';
  private detailsMarker: ui.Unobservable<MapMarker> | null = null;
  private detailsPaneOpened = false;
  private detailsPinMarker: ui.Unobservable<L.Marker> | null = null;

  private markerComponents = MARKER_COMPONENTS;
  private markerGroups: Map<string, MapMarkerGroup> = new Map();

  private searching = false;
  private searchQuery = '';
  private searchThrottler!: () => void;
  private searchLastSearchFailed = false;
  private searchResults: ObjectMinData[] = [];
  private searchResultMarkers: ui.Unobservable<MapMarkers.MapMarkerSearchResult>[] = [];
  private searchGroups: SearchResultGroup[] = [];
  private searchPresets = SEARCH_PRESETS;
  private searchExcludedSets: SearchExcludeSet[] = [];
  private readonly MAX_SEARCH_RESULT_COUNT = 2000;

  private hardModeExcludeSet!: SearchExcludeSet;
  private lastBossExcludeSet!: SearchExcludeSet;
  private ohoExcludeSet!: SearchExcludeSet;

  private areaMapLayer = new ui.Unobservable(L.layerGroup());
  private areaMapLayersByData: ui.Unobservable<Map<any, L.Layer[]>> = new ui.Unobservable(new Map());
  private areaAutoItem = new ui.Unobservable(L.layerGroup());

  shownAreaMap = '';
  areaWhitelist = '';
  showKorokIDs = false;
  shownAutoItem = '';
  staticTooltip = false;

  private mapUnitGrid = new ui.Unobservable(L.layerGroup());
  showMapUnitGrid = false;

  private mapSafeAreas = new ui.Unobservable(L.layerGroup());
  showSafeAreas = false;

  private mapCastleAreas = new ui.Unobservable(L.layerGroup());
  showCastleAreas = false;

  showBaseMap = true;
  showReferenceGrid = false;

  private tempObjMarker: ui.Unobservable<MapMarker> | null = null;

  private settings: Settings | null = null;

  // Replace current markers
  private importReplace: boolean = true;

  setViewFromRoute(route: any) {
    const x = parseFloat(route.params.x);
    const z = parseFloat(route.params.z);
    if (isNaN(x) || isNaN(z)) {
      this.$router.replace({ name: 'map' });
      return;
    }

    let zoom = parseInt(route.params.zoom);
    if (isNaN(zoom))
      zoom = 3;

    this.map.setView([x, 0, z], zoom);
  }
  updateRoute() {
    this.updatingRoute = true;
    // @ts-ignore
    this.$router.replace({
      name: 'map',
      params: {
        x: this.map.center[0],
        z: this.map.center[2],
        zoom: this.map.m.getZoom(),
      },
      query: this.$route.query,
    }).catch(err => {
      if (!isNavigationFailure(err, NavigationFailureType.duplicated)) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
    });
    this.updatingRoute = false;
  }

  initMapRouteIntegration() {
    this.setViewFromRoute(this.$route);
    this.map.zoom = this.map.m.getZoom();
    this.map.center = this.map.toXYZ(this.map.m.getCenter());
    this.map.registerMoveEndCb(() => this.updateRoute());
    this.map.registerZoomEndCb(() => this.updateRoute());
    this.updateRoute();
    this.map.registerBaseLayerChangeCb(() => this.updateMarkers());
  }

  initMarkers() {
    this.map.registerZoomCb(() => this.updateMarkers());
    this.updateMarkers();
  }

  // Similar to updateMarkers() but only called
  //   on toggle of KorokIDs
  updateKorokIDs() {
    let type = "Korok";
    const info = MapMgr.getInstance().getInfoMainField();
    if (Settings.getInstance().shownGroups.has(type)) {
      this.markerGroups.get(type)!.destroy();
      this.markerGroups.delete(type);

      const markers: any[] = info.markers[type];
      const component = MARKER_COMPONENTS[type];
      const group = new MapMarkerGroup(
        markers.map((m: any) => new (component.cl)(this.map, m, { showLabel: this.showKorokIDs })),
        valueOrDefault(component.preloadPad, 1.0),
        valueOrDefault(component.enableUpdates, true));
      this.markerGroups.set(type, group);
      group.addToMap(this.map.m);
      group.update();
    }
  }

  updateMarkers() {
    const info = MapMgr.getInstance().getInfoMainField();
    for (const type of Object.keys(info.markers)) {
      if (!Settings.getInstance().shownGroups.has(type)) {
        // Group exists and needs to be removed.
        if (this.markerGroups.has(type)) {
          this.markerGroups.get(type)!.destroy();
          this.markerGroups.delete(type);
        }
        continue;
      }

      // Nothing to do -- the group already exists.
      if (this.markerGroups.has(type))
        continue;

      const markers: any[] = info.markers[type];
      const component = MARKER_COMPONENTS[type];
      const group = new MapMarkerGroup(
        markers.map((m: any) => new (component.cl)(this.map, m, { showLabel: this.showKorokIDs })),
        valueOrDefault(component.preloadPad, 1.0),
        valueOrDefault(component.enableUpdates, true));
      this.markerGroups.set(type, group);
      group.addToMap(this.map.m);
    }

    for (const group of this.markerGroups.values())
      group.update();
  }

  initSidebar() {
    this.sidebar = L.control.sidebar({
      closeButton: true,
      container: 'sidebar',
      position: 'left',
    })
    this.sidebar.addTo(this.map.m);
    const el = (document.getElementById('sidebar-content'))!;
    const origOpen = this.sidebar.open;
    // Fires before switching the active pane.
    this.sidebar.open = (id: string) => {
      this.sidebarPaneScrollPos.set(this.sidebarActivePane, el.scrollTop);
      return origOpen.apply(this.sidebar, [id]);
    };
    // Fires after switching the active pane.
    this.sidebar.on('content', (e) => {
      // @ts-ignore
      const id: string = e.id;
      this.sidebarActivePane = id;
      el.scrollTop = this.sidebarPaneScrollPos.get(this.sidebarActivePane) || 0;
    });
    this.updateSidebarClass();
    this.updateHylianMode();
  }

  closeSidebar() {
    this.sidebar.close();
  }

  toggleSidebarSide() {
    Settings.getInstance().left = !Settings.getInstance().left;
    this.updateSidebarClass();
  }

  toggleHylianMode() {
    Settings.getInstance().hylianMode = !Settings.getInstance().hylianMode;
    this.updateHylianMode();
  }

  updateSidebarClass() {
    const el = (document.getElementById('sidebar'))!;
    if (Settings.getInstance().left) {
      el.classList.remove('leaflet-sidebar-right');
      el.classList.add('leaflet-sidebar-left');
    } else {
      el.classList.add('leaflet-sidebar-right');
      el.classList.remove('leaflet-sidebar-left');
    }
  }

  updateHylianMode() {
    const el = (document.getElementById('app'))!;
    if (Settings.getInstance().hylianMode) {
      el.classList.add('hylian-mode');
    } else {
      el.classList.remove('hylian-mode');
    }
  }

  switchPane(pane: string) {
    this.sidebar.open(pane);
  }

  private initGeojsonFeature(layer: any) {
    if (!(layer.setStyle))
      return;

    layer.on('mouseover', () => {
      layer.setStyle({ weight: 5 });
    });
    layer.on('mouseout', () => {
      layer.setStyle({ weight: 3 });
    });
    if (!layer.bindContextMenu) {
      return;
    }
    // @ts-ignore
    layer.bindContextMenu({
      contextmenu: true,
      contextmenuItems: [{
        text: 'Change color to current polyline color',
        index: 0,
        callback: () => {
          layer.setStyle({ color: this.drawLineColor });
          const id = this.drawLayer.getLayerId(layer);
          const opts = this.drawLayerOpts.find((layer: any) => layer.id == id);
          if (opts) {
            opts.color = this.drawLineColor;
          }
        },
      }, {
        separator: true,
        index: 1,
      }],
    });
  }

  toggleLayerVisibility(event: any) {
    const layer = this.drawLayer.getLayer(event.target.id);
    if (!layer)
      return;
    if (this.map.m.hasLayer(layer)) {
      layer.remove();
    } else {
      layer.addTo(this.map.m);
    }
  }

  changeLayerColor(event: any) {
    const id = Number(event.target.attributes.layer_id.value);
    const color = event.target.value;
    const layer: any = this.drawLayer.getLayer(id);
    if (!layer)
      return;
    layer.options.color = color;
    if (ui.leafletType(layer) == ui.LeafletType.Marker) {
      layer.setIcon(ui.svgIcon(color));
    } else {
      layer.setStyle({ color: layer.options.color });
    }
    const layerOpt = this.drawLayerOpts.find((layer: any) => layer.id == id);
    if (layerOpt) {
      layerOpt.color = color;
    }
  }

  createDrawLayerOpts() {
    if (!this.drawLayer)
      return [];
    const layerIDs = this.drawLayer.getLayers().map((layer: any) => {
      let props = layer.feature.properties;
      const id = this.drawLayer.getLayerId(layer);
      return {
        id,
        color: layer.options.color,
        order: props.order,
        title: props.title,
        text: props.text,
        length: (ui.leafletType(layer) == ui.LeafletType.Marker) ? "" : props.pathLength.toFixed(2),
        visible: true,
      };
    })
    // order values < 0 are appended at the end and given a value
    const ordered = layerIDs.filter((layer: any) => layer.order >= 0);
    const unordered = layerIDs.filter((layer: any) => layer.order < 0);
    let n = ordered.length;
    unordered.forEach((layer: any) => { layer.order = n++; });
    ordered.push(...unordered);
    layerIDs.sort((a: any, b: any) => a.order - b.order);
    return layerIDs;
  }

  updateDrawLayerOptsIndex() {
    this.drawLayerOpts.forEach((layer: any, k: number) => {
      layer.order = k;
      // @ts-ignore
      this.drawLayer.getLayer(layer.id).feature.properties.order = k;
    });
  }

  updateDrawLayerOpts(updates: any = {}) {
    this.$nextTick(() => {
      if (updates.layer) {
        let id = this.drawLayer.getLayerId(updates.layer);
        let opt = this.drawLayerOpts.find((layer: any) => layer.id == id)
        if (opt) {
          opt.title = updates.title || opt.title;
          opt.text = updates.text || opt.text;
        }
      } else {
        this.drawLayerOpts = this.createDrawLayerOpts();
      }
      this.updateDrawLayerOptsIndex();
    });
  }

  initDrawTools() {
    this.drawLayer = new L.GeoJSON(undefined, {
      style: (feature) => {
        // @ts-ignore
        return feature.style || {};
      },
      onEachFeature: (feature, layer) => { this.initGeojsonFeature(layer); },
    });
    const savedData = Settings.getInstance().drawLayerGeojson;
    if (savedData)
      this.drawFromGeojson(JSON.parse(savedData));
    this.drawLayer.addTo(this.map.m);
    const options = {
      position: 'topleft',
      draw: {
        circlemarker: false,
        rectangle: { showRadius: false },
        marker: {
          icon: ui.svgIcon(this.drawLineColor),
          repeatMode: false,
        }
      },
      edit: {
        featureGroup: this.drawLayer,
      },
    };
    // @ts-ignore
    this.drawControl = new L.Control.Draw(options);
    this.setLineColorThrottler = debounce(() => this.setLineColor(), 100);
    this.map.m.on({
      // @ts-ignore
      'draw:created': (e: any) => {
        addGeoJSONFeatureToLayer(e.layer);
        calcLayerLength(e.layer);
        addPopupAndTooltip(e.layer, this);
        this.drawLayer.addLayer(e.layer);
        this.initGeojsonFeature(e.layer);
        if (!e.layer.options.color) {
          e.layer.options.color = this.drawLineColor;
        }
        this.updateDrawLayerOpts();
      },
      'draw:edited': (e: any) => {
        e.layers.eachLayer((layer: L.Marker | L.Polyline) => {
          calcLayerLength(layer);
          layerSetTooltip(layer);
        });
        this.updateDrawLayerOpts();
      },
      'draw:deleted': (e: any) => {
        // Only use confirm dialog if editable layer is empty and
        //   the layers passed are not empty
        // A 'Save' action should have a possibly non-empty editable layer
        if (this.drawLayer.getLayers().length == 0 && e.layers.getLayers().length != 0) {
          let ans = confirm("Clear all map items?");
          if (!ans) {
            e.layers.eachLayer((layer: L.Marker | L.Polyline) => this.drawLayer.addLayer(layer));
          }
        }
        this.updateDrawLayerOpts();
      },
    });
    this.drawOnColorChange({});
    Settings.getInstance().registerBeforeSaveCallback(() => {
      Settings.getInstance().drawLayerGeojson = JSON.stringify(this.drawToGeojson());
    });
    this.updateDrawControlsVisibility();
    this.updateDrawLayerOpts();
  }

  private layerFromGeoJSON(feat: any): L.Layer {
    let isCircle = feat.geometry.type == "Point" && feat.properties.radius;
    if (isCircle) {
      let latlon = L.latLng(feat.geometry.coordinates[1], feat.geometry.coordinates[0]);
      return new L.Circle(latlon, { radius: feat.properties.radius });
    }
    return L.GeoJSON.geometryToLayer(feat);
  }

  private drawFromGeojson(data: any) {
    if (this.importReplace) {
      this.drawLayer.clearLayers();
    }
    data.features.forEach((feat: any) => {
      let layer: any = this.layerFromGeoJSON(feat);
      // Only set style for Polylines not Markers
      let color = feat.style.color || this.drawLineColor;
      if (ui.leafletType(layer) == ui.LeafletType.Marker) {
        layer.options.color = color;
        layer.setIcon(ui.svgIcon(color));
      } else {
        layer.setStyle({ color: color });
      }
      // Create Feature.Properties on Layer
      addGeoJSONFeatureToLayer(layer);
      // Copy Properties from GeoJSON
      layer.feature.properties.fromGeoJSON(feat);
      calcLayerLength(layer);
      addPopupAndTooltip(layer, this);
      this.drawLayer.addLayer(layer);
      this.initGeojsonFeature(layer);
    });
    this.updateDrawLayerOpts();
  }

  private drawToGeojson(): GeoJSON.FeatureCollection {
    const data = <GeoJSON.FeatureCollection>(this.drawLayer.toGeoJSON());
    // XXX: Terrible hack to add colors to LineStrings.
    let i = 0;
    this.drawLayer.eachLayer(layer => {
      // @ts-ignore
      data.features[i].style = {
        // @ts-ignore
        color: layer.options.color,
      };
      if (ui.leafletType(layer) == ui.LeafletType.Circle) {
        // @ts-ignore
        data.features[i].properties.radius = (layer as L.Circle).options.radius;
      }
      ++i;
    });
    return data;
  }

  toggleDraw() {
    Settings.getInstance().drawControlsShown = !Settings.getInstance().drawControlsShown;
    this.updateDrawControlsVisibility();
  }

  updateDrawControlsVisibility() {
    if (Settings.getInstance().drawControlsShown)
      this.drawControl.addTo(this.map.m);
    else
      this.drawControl.remove();
  }

  drawImport() {
    const input = <HTMLInputElement>(document.getElementById('fileinput'));
    input.click();
  }

  private async drawImportCb() {
    const input = <HTMLInputElement>(document.getElementById('fileinput'));
    if (!input.files!.length)
      return;
    try {
      const rawData = await (new Response(input.files![0])).json();
      const version: number | undefined = rawData.OBJMAP_SV_VERSION;
      if (!version) {
        this.drawFromGeojson(rawData);
      } else {
        const data = <save.SaveData>(rawData);
        this.drawFromGeojson(data.drawData);
        if (version >= 2) {
          data.searchGroups.forEach(g => {
            this.searchAddGroup(g.query, g.label, g.enabled);
          });
          data.searchExcludeSets.forEach(g => {
            this.searchAddExcludedSet(g.query, g.label);
          });
        }
      }
    } catch (e) {
      alert(e);
    } finally {
      input.value = '';
    }
  }

  drawExport() {
    const data: save.SaveData = {
      OBJMAP_SV_VERSION: save.CURRENT_OBJMAP_SV_VERSION,
      drawData: this.drawToGeojson(),
      searchGroups: this.searchGroups.map(g => ({
        label: g.label,
        query: g.query,
        enabled: g.enabled,
      })),
      searchExcludeSets: this.searchExcludedSets.filter(g => !g.hidden).map(g => ({
        label: g.label,
        query: g.query,
      })),
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'objmap_save.json';
    a.click();
  }

  setLineColor() {
    this.drawControl.setDrawingOptions({
      polyline: { shapeOptions: { color: this.drawLineColor, opacity: 1.0 } },
      polygon: { shapeOptions: { color: this.drawLineColor, opacity: 1.0 } },
      circle: { shapeOptions: { color: this.drawLineColor, opacity: 1.0 } },
      rectangle: { shapeOptions: { color: this.drawLineColor, opacity: 1.0 } },
      marker: {
        icon: ui.svgIcon(this.drawLineColor),
        repeatMode: false,
      }
    });
  }

  drawOnColorChange(ev: any) {
    if (ev.target) {
      this.drawLineColor = ev.target.value;
    }
    this.setLineColorThrottler();
  }

  showGreatPlateauBarrier() {
    if (!this.greatPlateauBarrierShown) {
      const RESPAWN_POS: Point = [-1021.7286376953125, 0, 1792.6009521484375];
      const respawnPosMarker = new MapMarkers.MapMarkerPlateauRespawnPos(this.map, RESPAWN_POS);
      const topLeft = this.map.fromXYZ([-1600, 0, 1400]);
      const bottomRight = this.map.fromXYZ([-350, 0, 2400]);
      const rect = L.rectangle(L.latLngBounds(topLeft, bottomRight), {
        fill: false,
        stroke: true,
        color: '#c50000',
        weight: 2,
        // @ts-ignore
        contextmenu: true,
        contextmenuItems: [{
          text: 'Hide barrier and respawn point',
          callback: () => {
            respawnPosMarker.getMarker().remove();
            rect.remove();
            this.greatPlateauBarrierShown = false;
          },
        }],
      });
      rect.addTo(this.map.m);
      respawnPosMarker.getMarker().addTo(this.map.m);
      this.greatPlateauBarrierShown = true;
    }
    this.map.setView([-965, 0.0, 1875], 5);
  }

  gotoOnSubmit(xyz: Point) {
    this.map.setView(xyz);
    if (this.previousGotoMarker)
      this.previousGotoMarker.remove();
    this.previousGotoMarker = L.marker(this.map.fromXYZ(xyz), {
      // @ts-ignore
      contextmenu: true,
      contextmenuItems: [{
        text: 'Hide',
        callback: () => { this.previousGotoMarker!.remove(); this.previousGotoMarker = null; },
      }],
    }).addTo(this.map.m);
  }

  initMarkerDetails() {
    this.map.registerMarkerSelectedCb((marker: MapMarker) => {
      this.openMarkerDetails(getMarkerDetailsComponent(marker), marker);
    });
    this.map.m.on({ 'click': () => this.closeMarkerDetails() });
  }

  openMarkerDetails(component: string, marker: MapMarker, zoom = -1) {
    this.closeMarkerDetails(true);
    this.detailsMarker = new ui.Unobservable(marker);
    this.detailsComponent = component;
    this.switchPane('spane-details');
    this.detailsPaneOpened = true;
    this.detailsPinMarker = new ui.Unobservable(L.marker(marker.getMarker().getLatLng(), {
      pane: 'front',
    }).addTo(this.map.m));

    if (zoom == -1)
      this.map.m.panTo(marker.getMarker().getLatLng());
    else
      this.map.m.setView(marker.getMarker().getLatLng(), zoom);

    if (marker instanceof MapMarkers.MapMarkerObj || marker instanceof MapMarkers.MapMarkerKorok) {
      this.switchToObjectLayer(marker.obj);
    }
  }

  closeMarkerDetails(forOpen = false) {
    if (!this.detailsPaneOpened)
      return;
    this.detailsComponent = '';
    this.detailsMarker = null;
    if (!forOpen) {
      this.sidebar.close();
    }
    if (this.detailsPinMarker) {
      this.detailsPinMarker.data.remove();
      this.detailsPinMarker = null;
    }
    this.detailsPaneOpened = false;
  }

  initSearch() {
    this.searchThrottler = debounce(() => this.search(), 200);

    this.map.registerZoomCb(() => {
      for (const group of this.searchGroups)
        group.update(0, this.searchExcludedSets);
    });
  }

  searchGetQuery() {
    let query = this.searchQuery.trim();
    //if (/^0x[0-9A-Fa-f]{6}/g.test(query))
    //  query = BigInt(query).toString(10);
    return query;
  }

  searchJumpToResult(idx: number) {
    const marker = this.searchResultMarkers[idx];
    this.openMarkerDetails(getMarkerDetailsComponent(marker.data), marker.data, 6);
  }

  searchOnInput() {
    this.searching = true;
    this.searchThrottler();
  }

  searchOnAdd() {
    this.searchAddGroup(this.searchGetQuery());
    this.searchQuery = '';
    this.search();
  }

  searchOnExclude() {
    this.searchAddExcludedSet(this.searchGetQuery());
    this.searchQuery = '';
    this.search();
  }

  async searchAddExcludedSet(query: string, label?: string) {
    if (this.searchExcludedSets.some(g => !!g.query && g.query == query))
      return;

    const set = new SearchExcludeSet(query, query);
    this.searchExcludedSets.push(set);
    await set.init();
    for (const group of this.searchGroups)
      group.update(SearchResultUpdateMode.UpdateVisibility, this.searchExcludedSets);
  }

  async searchAddGroup(query: string, label?: string, enabled = true) {
    if (this.searchGroups.some(g => !!g.query && g.query == query))
      return;

    const group = new SearchResultGroup(query, label || query, enabled);
    await group.init(this.map);
    group.update(SearchResultUpdateMode.UpdateStyle | SearchResultUpdateMode.UpdateVisibility, this.searchExcludedSets);
    this.searchGroups.push(group);
    this.updateTooltips();
  }

  searchToggleGroupEnabledStatus(idx: number) {
    const group = this.searchGroups[idx];
    group.update(SearchResultUpdateMode.UpdateVisibility, this.searchExcludedSets);
  }

  searchViewGroup(idx: number) {
    const group = this.searchGroups[idx];
    this.searchQuery = group.query;
    this.search();
  }

  searchRemoveGroup(idx: number) {
    const group = this.searchGroups[idx];
    group.remove();
    this.searchGroups.splice(idx, 1);
  }

  searchRemoveExcludeSet(idx: number) {
    this.searchExcludedSets.splice(idx, 1);
    for (const group of this.searchGroups)
      group.update(SearchResultUpdateMode.UpdateVisibility, this.searchExcludedSets);
  }

  async search() {
    this.searching = true;
    this.searchResultMarkers.forEach(m => m.data.getMarker().remove());
    this.searchResultMarkers = [];

    const query = this.searchGetQuery();
    try {
      this.searchResults = await MapMgr.getInstance().getObjs(this.settings!.mapType, this.settings!.mapName, query, false, this.MAX_SEARCH_RESULT_COUNT);
      this.searchLastSearchFailed = false;
    } catch (e) {
      this.searchResults = [];
      this.searchLastSearchFailed = true;
    }

    for (const result of this.searchResults) {
      const marker = new ui.Unobservable(new MapMarkers.MapMarkerSearchResult(this.map, result));
      this.searchResultMarkers.push(marker);
      marker.data.getMarker().addTo(this.map.m);
    }

    this.updateTooltips();
    this.searching = false;
  }

  enableYTooltip(marker: any) {
    let m: any = marker.getMarker();
    if (!('_tooltip' in marker.obj)) {
      // @ts-ignore
      let tt = m.getTooltip();
      marker.obj._tooltip = tt.getContent();
      marker.obj._tooltip_options = tt.options;
    }
    //To update the tooltip with the permanent flag,
    //   we needed to unbind() then re-bind() the tooltip
    //   with a different permanent flag value.
    if (!m.getTooltip().options.permanent) {
      m.unbindTooltip();
      m.bindTooltip(`${marker.obj.pos[1]}`, { permanent: true });
      m.openTooltip();
    }
  }

  disableYTooltip(marker: any) {
    let m: any = marker.getMarker();
    if (m.getTooltip().options.permanent) {
      m.getTooltip().options.permanent = false;
      m.unbindTooltip();
      m.bindTooltip(marker.obj._tooltip, marker.obj._tooltip_options);
      m.closeTooltip();
    }
  }

  toggleYTooltipOnAllMarkers(on: boolean) {
    let func = on ? this.enableYTooltip : this.disableYTooltip;
    this.searchResultMarkers.map(m => m.data).forEach(func);
    this.searchGroups.forEach(group => {
      group.getMarkers().forEach(func);
    });
  }

  updateTooltips() {
    this.toggleYTooltipOnAllMarkers(this.staticTooltip);
  }

  toggleY() {
    this.staticTooltip = !this.staticTooltip;
    this.updateTooltips();
  }

  initContextMenu() {
    this.map.m.on(SHOW_ALL_OBJS_FOR_MAP_UNIT_EVENT, (e) => {
      const mapType = Settings.getInstance().mapType;
      const mapName = Settings.getInstance().mapName;

      if (mapType != "Totk") {
        if (mapName.length !== 0)
          this.searchAddGroup("*", `Map: ${mapType}/${mapName}`);
        else
          this.searchAddGroup("*", `Maps: ${mapType}`);
        return;
      }

      // @ts-ignore
      const latlng: L.LatLng = e.latlng;
      const xyz = this.map.toXYZ(latlng);
      if (!map.isValidPoint(xyz))
        return;
      const quad = map.pointToMapUnit(xyz);
      this.searchAddGroup(`map:"${quad}"`, `Map: Sky/Surface/Depths ${quad}`);
    });
  }

  initEvents() {
    this.$on('AppMap:switch-pane', (pane: string) => {
      this.switchPane(pane);
    });
    this.$on('AppMap:toggle-y-values', () => {
      this.toggleY();
    });

    this.$on('AppMap:open-obj', async (obj: ObjectData) => {
      if (this.tempObjMarker)
        this.tempObjMarker.data.getMarker().remove();
      this.tempObjMarker = new ui.Unobservable(new MapMarkers.MapMarkerObj(this.map, obj, '#e02500', '#ff2a00'));
      this.tempObjMarker.data.getMarker().addTo(this.map.m);
      this.openMarkerDetails(getMarkerDetailsComponent(this.tempObjMarker.data), this.tempObjMarker.data);
    });

    this.map.m.on('click', () => {
      if (this.tempObjMarker)
        this.tempObjMarker.data.getMarker().remove();
    });

    this.$on('AppMap:show-gen-group', async (id: ObjectIdentifier) => {
      const group = new SearchResultGroup('', `Generation group for ${id.mapType}/${id.mapName}:${id.hashId}`);
      await group.init(this.map);
      const objs = await MapMgr.getInstance().getObjGenGroup(id.mapType, id.mapName, id.hashId);
      group.setObjects(this.map, objs);
      group.update(SearchResultUpdateMode.UpdateStyle | SearchResultUpdateMode.UpdateVisibility, this.searchExcludedSets);
      this.searchGroups.push(group);
    });
    this.map.m.on('AppMap:show-gen-group', (args) => {
      this.$emit('AppMap:show-gen-group', args);
    });
  }

  initSettings() {
    this.reloadSettings();
    Settings.getInstance().registerCallback(() => this.reloadSettings());
  }

  private reloadSettings() {
    for (const group of this.searchGroups)
      group.update(SearchResultUpdateMode.UpdateVisibility | SearchResultUpdateMode.UpdateStyle | SearchResultUpdateMode.UpdateTitle, this.searchExcludedSets);

    this.searchResultMarkers.forEach(m => m.data.updateTitle());
  }

  initAreaMap() {
    this.areaMapLayer.data.addTo(this.map.m);
  }
  initAutoItem() {
    this.areaAutoItem.data.addTo(this.map.m);
  }

  async loadAutoItem(name: string) {
    this.areaAutoItem.data.clearLayers();
    if (!name)
      return;
    const areas = await MapMgr.getInstance().fetchAreaMap(name);
    let layers: L.Path[] = ui.areaMapToLayers(areas);
    layers.forEach(l => this.areaAutoItem.data.addLayer(l));
    this.areaAutoItem.data.setZIndex(1000);
  }

  featureCollectionToPolygons(areas: any) {
    return Object.fromEntries(areas.features.map((feat: any) => {
      feat.geometry.properties = { title: feat.properties.Area.toString() }
      return [feat.properties.Area, [feat.geometry]]
    }))
  }
  isFeatureCollection(area: any) {
    return area && area.type && area.type == "FeatureCollection";
  }

  async loadAreaMap(name: string) {
    this.areaMapLayer.data.clearLayers();
    this.areaMapLayersByData.data.clear();
    if (!name)
      return;
    // Order matches that in MapTower.json
    const mapTowerAreas = ["Hebra", "Tabantha", "Gerudo", "Wasteland",
      "Woodland", "Central", "Great Plateau", "Dueling Peaks",
      "Lake", "Eldin", "Akkala", "Lanayru", "Hateno",
      "Faron", "Ridgeland"];
    const climate_names = [
      'HyrulePlainClimate',
      'NorthHyrulePlainClimate',
      'HebraFrostClimate',
      'TabantaAridClimate',
      'FrostClimate',
      'GerudoDesertClimate',
      'GerudoPlateauClimate',
      'EldinClimateLv0',
      'TamourPlainClimate',
      'ZoraTemperateClimate',
      'HateruPlainClimate',
      'FiloneSubtropicalClimate',
      'SouthHateruHumidTemperateClimate',
      'EldinClimateLv1',
      'EldinClimateLv2',
      // sic
      'DarkWoodsClimat',
      'LostWoodClimate',
      'GerudoFrostClimate',
      'KorogForest',
      'GerudoDesertClimateLv2'
    ];

    let areas = await MapMgr.getInstance().fetchAreaMap(name);
    if (this.isFeatureCollection(areas)) {
      areas = this.featureCollectionToPolygons(areas as any)
    }
    const entries = Object.entries(areas);
    let i = 0;
    for (const [data, features] of entries) {
      const layers: L.GeoJSON[] = features.map((feature: any) => {
        return L.geoJSON(feature, {
          style: function(_) {
            return { weight: 2, fillOpacity: 0.2, color: ui.genColor(entries.length, i) };
          },
          // @ts-ignore
          contextmenu: true,
          // @ts-ignore
        });
      });
      this.areaMapLayersByData.data.set(data, layers);

      for (const layer of layers) {
        layer.on('mouseover', () => {
          layers.forEach(l => {
            l.setStyle({ weight: 4, fillOpacity: 0.3 });
          });
        });
        layer.on('mouseout', () => {
          layers.forEach(l => l.setStyle({ weight: 2, fillOpacity: 0.2 }));
        });
        if (name == "MapTower") {
          layer.bindTooltip(features[0].properties.title);
          continue;
        }
        const area = await MsgMgr.getInstance().getAreaData(name, parseInt(data));
        const climate = await MsgMgr.getInstance().getClimateData(area.Climate);
        const area_name = MsgMgr.getInstance().getMsgWithFile("StaticMsg/LocationMarker", area.Name);
        let label = (area_name) ? `${area_name} #${data}` : `Area #${data}`;
        for (const kind of ['Bluesky', 'Cloudy', 'Rain', 'Storm', 'HeavyRain']) {
          const rate = climate.Weather[`${kind}Rate`];
          if (rate > 0) {
            label += `<br/>${rate}%: ${kind}`;
          }
        }
        if (climate.EnvFireLevel > 0) {
          label += "<br/>"
          for (let i = 0; i < climate.EnvFireLevel; i++)
            label += `&#128293;`; // Ugh, Fire is not Lava
          label += ` Fire Level ${climate.EnvFireLevel}`
        }
        if (name == "Sky" || name == "MinusField") {
          let cname = (name == "Sky") ? "Sky" : "UnderGround";
          let day = climate.DayTemperature[cname];
          let night = climate.NightTemperature[cname]
          let night_emoji = this.temperatureEmoji(night);
          let day_emoji = this.temperatureEmoji(day);

          if (day != night) {
            label += `<br/>${day} ${day_emoji}/ ${night}&deg;C ${night_emoji}`;
          } else {
            label += `<br/>${day}&deg;C ${day_emoji}`;
          }
        }
        layer.bindTooltip(label);
      }
      ++i;
    }
    this.updateAreaMapVisibility();
  }

  temperatureEmoji(temp: number) {
    const cold = "&#129398;";
    const hot = "&#129397;";

    if (temp < -10)
      return `${cold}${cold}`;
    else if (temp < 0)
      return cold
    else if (temp > 50)
      return `${hot}${hot}`
    else if (temp > 40)
      return hot
    return "";
  }

  updateAreaMapVisibility() {
    const hasWhitelist = !!this.areaWhitelist;
    const shown = this.areaWhitelist.trim().split(',').map(s => s.trim());
    this.areaMapLayer.data.clearLayers();
    for (const [data, layers] of this.areaMapLayersByData.data.entries()) {
      if (!hasWhitelist || shown.includes(data))
        layers.forEach(l => this.areaMapLayer.data.addLayer(l));
    }
  }

  onShownAreaMapChanged() {
    this.$nextTick(() => this.loadAreaMap(this.shownAreaMap));
  }
  onShownAutoItemChanged() {
    this.$nextTick(() => this.loadAutoItem(this.shownAutoItem));
  }

  async initMapSafeAreas() {
    const areas = await MapMgr.getInstance().fetchAreaMap("AutoSafe");
    let layers: L.Path[] = ui.areaMapToLayers(areas);
    layers.forEach(l => this.mapSafeAreas.data.addLayer(l));
  }

  async initMapCastleAreas() {
    const areas: any = await MapMgr.getInstance().fetchAreaMap("castle");
    const features = areas.features;

    const layers: L.GeoJSON[] = features.map((feature: any, i: number) => {
      let color = ui.genColor(300, feature.properties.y);
      let layer = L.geoJSON(feature, {
        style: function(_) {
          return { weight: 2, fillOpacity: 0.2, color: color };
        },
        // @ts-ignore
        contextmenu: true,
      });
      layer.bindTooltip(`${feature.properties.name} @ ${feature.properties.y}`);
      layer.on('mouseover', () => { layer.setStyle({ weight: 4, fillOpacity: 0.3 }); });
      layer.on('mouseout', () => { layer.setStyle({ weight: 2, fillOpacity: 0.2 }); });
      return layer;
    });
    layers.forEach(l => this.mapCastleAreas.data.addLayer(l));

    this.mapCastleAreas.data.setZIndex(1000);
  }


  initMapUnitGrid() {
    for (let i = 0; i < 10; ++i) {
      for (let j = 0; j < 8; ++j) {
        const topLeft: Point = [-5000.0 + i * 1000.0, 0.0, -4000.0 + j * 1000.0];
        const bottomRight: Point = [-5000.0 + (i + 1) * 1000.0, 0.0, -4000.0 + (j + 1) * 1000.0];
        const rect = L.rectangle(L.latLngBounds(this.map.fromXYZ(topLeft), this.map.fromXYZ(bottomRight)), {
          fill: true,
          stroke: true,
          color: '#009dff',
          fillOpacity: 0.13,
          weight: 2,
          // @ts-ignore
          contextmenu: true,
        });
        rect.bringToBack();
        rect.bindTooltip(map.pointToMapUnit(topLeft), {
          permanent: true,
          direction: 'center',
        });
        this.mapUnitGrid.data.addLayer(rect);
      }
    }
  }

  onShowMapUnitGridChanged() {
    this.$nextTick(() => {
      this.mapUnitGrid.data.remove();
      if (this.showMapUnitGrid)
        this.mapUnitGrid.data.addTo(this.map.m);
    });
  }

  onShowCastleAreas() {
    this.$nextTick(() => {
      this.mapCastleAreas.data.remove();
      if (this.showCastleAreas) {
        if (this.mapCastleAreas.data.getLayers().length <= 0) {
          this.initMapCastleAreas();
        }
        this.mapCastleAreas.data.addTo(this.map.m);
      }
    });
  }

  onShowSafeAreas() {
    this.$nextTick(() => {
      this.mapSafeAreas.data.remove();
      if (this.showSafeAreas) {
        if (this.mapSafeAreas.data.getLayers().length <= 0) {
          this.initMapSafeAreas();
        }
        this.mapSafeAreas.data.addTo(this.map.m);
      }
    });
  }

  onShowReferenceGrid() {
    this.$nextTick(() => {
      this.map.showReferenceGrid(this.showReferenceGrid);
    });
  }

  private switchToObjectLayer(obj: ObjectMinData) {
    if (obj.map_type != "Totk") {
      return;
    }

    if (!obj.map_name) {
      return;
    }

    if (obj.map_name.startsWith("Depths")) {
      this.map.switchBaseTileLayer("Depths");
    } else if (obj.map_name.startsWith("Sky")) {
      this.map.switchBaseTileLayer("Sky");
    } else {
      this.map.switchBaseTileLayer("Surface");
    }
  }

  created() {
    this.settings = Settings.getInstance();
  }

  mounted() {
    this.map = new MapBase('lmap');
    this.map.registerZoomChangeCb((zoom) => this.zoom = zoom);
    this.initMapRouteIntegration();
    this.initMarkers();
    this.initAreaMap();
    this.initAutoItem();
    this.initMapUnitGrid();
    this.initSidebar();
    this.initDrawTools();
    this.initMarkerDetails();
    this.initSearch();
    this.initContextMenu();
    this.initEvents();
    this.initSettings();

    if (this.$route.query.q) {
      this.searchQuery = this.$route.query.q.toString();
      this.search();
      this.switchPane('spane-search');
    }

    if (this.$route.query.id) {
      // format: MapType,MapName,HashId
      const [mapType, mapName, hashId] = this.$route.query.id.toString().split(',');
      MapMgr.getInstance().getObj(mapType, mapName, hashId)
        .then(async (obj) => {
          if (!obj) {
            obj = await MapMgr.getInstance().getObjByHashId(hashId);

            // The user messed up the map type or map name.
            // Fix the query string for them.
            if (obj) {
              this.$router.replace({
                path: this.$route.fullPath,
                query: {
                  ...this.$route.query,
                  id: [obj.map_type, obj.map_name, obj.hash_id].join(","),
                },
              });
            }
          }

          if (obj) {
            this.$emit('AppMap:open-obj', obj);
          }
        });
    }
  }

  beforeDestroy() {
    this.map.m.remove();
  }

  beforeRouteUpdate(to: any, from: any, next: any) {
    if (!this.updatingRoute)
      this.setViewFromRoute(to);
    next();
  }
}
