/**
 * Copyright 2019-2021 Sourcepole AG
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios from 'axios';
import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import isEmpty from 'lodash.isempty';
import {stringify} from 'wellknown';
import {LayerRole, addMarker, removeMarker, removeLayer} from 'qwc2/actions/layers';
import {changeSelectionState} from 'qwc2/actions/selection';
import IdentifyViewer from 'qwc2/components/IdentifyViewer';
import ResizeableWindow from 'qwc2/components/ResizeableWindow';
import TaskBar from 'qwc2/components/TaskBar';
import IdentifyUtils from 'qwc2/utils/IdentifyUtils';
import LocaleUtils from 'qwc2/utils/LocaleUtils';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';

// additional imports for PlotInfoTool
/* 
Already imported by original Identify Plugin

import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import isEmpty from 'lodash.isempty';
import axios from 'axios';
*/
import FileSaver from 'file-saver';
import {logAction} from 'qwc2/actions/logging';
import ConfigUtils from 'qwc2/utils/ConfigUtils';
import {clearSearch} from 'qwc2/actions/search';
import {setCurrentTask} from 'qwc2/actions/task';
import {
    // LayerRole, => already imported by original Identify Plugin
    // removeLayery, => already imported by original Identify Plugin
    addThemeSublayer,
    addLayerFeatures
} from 'qwc2/actions/layers';
/* 
Already imported by original Identify Plugin

import ResizeableWindow from 'qwc2/components/ResizeableWindow'; 
*/
import Spinner from 'qwc2/components/Spinner';
import Icon from 'qwc2/components/Icon';
import {zoomToPoint} from 'qwc2/actions/map';
import {UrlParams} from 'qwc2/utils/PermaLinkUtils';
import CoordinatesUtils from 'qwc2/utils/CoordinatesUtils';

/* 
Already imported by original Identify Plugin

import LocaleUtils from 'qwc2/utils/LocaleUtils'; 
*/
import MapUtils from 'qwc2/utils/MapUtils';
import VectorLayerUtils from 'qwc2/utils/VectorLayerUtils';

import './style/PlotInfoTool.css';

import 'react-tabs/style/react-tabs.css';
 
class PlotInfoTool extends React.Component {
    static propTypes = {
        addLayerFeatures: PropTypes.func,
        addMarker: PropTypes.func,
        addThemeSublayer: PropTypes.func,
        attributeCalculator: PropTypes.func,
        attributeTransform: PropTypes.func,
        changeSelectionState: PropTypes.func,
        clearSearch: PropTypes.func,
        click: PropTypes.object,
        currentIdentifyTool: PropTypes.string,
        currentTask: PropTypes.string,
        customInfoComponents: PropTypes.object,
        displayResultTree: PropTypes.bool,
        enableExport: PropTypes.bool,
        featureInfoReturnsLayerName: PropTypes.bool,
        iframeDialogsInitiallyDocked: PropTypes.bool,
        infoQueries: PropTypes.array,
        initialHeight: PropTypes.number,
        initialWidth: PropTypes.number,
        initiallyDocked: PropTypes.bool,
        layers: PropTypes.array,
        logAction: PropTypes.func,
        longAttributesDisplay: PropTypes.string,
        map: PropTypes.object,
        params: PropTypes.object,
        removeLayer: PropTypes.func,
        removeMarker: PropTypes.func,
        selection: PropTypes.object,
        setCurrentTask: PropTypes.func,
        theme: PropTypes.object,
        themeLayerRestorer: PropTypes.func,
        toolLayers: PropTypes.array,
        windowSize: PropTypes.object,
        zoomToPoint: PropTypes.func
    }
    static defaultProps = {
        enableExport: true,
        longAttributesDisplay: 'ellipsis',
        displayResultTree: true,
        initialWidth: 240,
        initialHeight: 320,
        featureInfoReturnsLayerName: true,
        toolLayers: [],
        infoQueries: [],
        customInfoComponents: {}
    }
    state = {
        mode: 'Point',
        identifyResults: null,
        pendingRequests: 0,
        plotInfo: null,
        currentPlot: null,
        expandedInfo: null,
        expandedInfoData: null,
        pendingPdfs: []
    }

    componentDidUpdateIdentify(prevProps, prevState) {
        if (this.props.currentIdentifyTool !== prevProps.currentIdentifyTool && prevProps.currentIdentifyTool === "Identify") {
            this.clearResults();
        }
        if ((this.props.currentTask === "Identify" && this.state.mode === "Point") || this.props.currentIdentifyTool === "Identify") {
            this.identifyPoint(prevProps);
        } else if (this.props.currentTask === "Identify" && this.state.mode === "Region") {
            this.identifyRegion(prevProps);
        }
    }

    componentDidUpdatePlotInfoTool(prevProps, prevState) {
        const clickPoint = this.queryPoint(prevProps);
        if (clickPoint) {
            console.log('we go to query basic point');
            this.queryBasicInfoAtPoint(clickPoint);
        }

        if (this.state.plotInfo) {
            if (
                this.state.plotInfo !== prevState.plotInfo ||
                this.state.currentPlot !== prevState.currentPlot
            ) {
                const layer = {
                    id: "plotselection",
                    role: LayerRole.SELECTION
                };
                const wkt = this.state.plotInfo[this.state.currentPlot].geom;
                const feature = VectorLayerUtils.wktToGeoJSON(wkt, "EPSG:2056", this.props.map.projection);
                feature.styleName = 'default';
                feature.styleOptions = {
                    fillColor: [0, 0, 0, 0],
                    strokeColor: [242, 151, 84, 0.75],
                    strokeWidth: 8,
                    strokeDash: []
                };
                this.props.addLayerFeatures(layer, [feature], true);
            }
        } else if (prevState.plotInfo && !this.state.plotInfo) {
            this.props.removeLayer("plotselection");
        }
    }

    componentDidUpdate(prevProps, prevState) {
        this.componentDidUpdateIdentify(prevProps, prevState);
        this.componentDidUpdatePlotInfoTool(prevProps, prevState);
    }

    identifyPoint = (prevProps) => {
        const clickPoint = this.queryPoint(prevProps);
        if (clickPoint) {
            // Remove any search selection layer to avoid confusion
            this.props.removeLayer("searchselection");
            let pendingRequests = 0;
            const identifyResults = this.props.click.modifiers.ctrl !== true ? {} : this.state.identifyResults;

            let queryableLayers = [];
            queryableLayers = IdentifyUtils.getQueryLayers(this.props.layers, this.props.map);
            queryableLayers.forEach(l => {
                const request = IdentifyUtils.buildRequest(l, l.queryLayers.join(","), clickPoint, this.props.map, this.props.params);
                ++pendingRequests;
                axios.get(request.url, {params: request.params}).then((response) => {
                    this.setState({pendingRequests: this.state.pendingRequests - 1});
                    this.parseResult(response.data, l, request.params.info_format, clickPoint);
                }).catch((e) => {
                    console.log(e);
                    this.setState({pendingRequests: this.state.pendingRequests - 1});
                });
            });

            let queryFeature = null;
            if (this.props.click.feature) {
                const layer = this.props.layers.find(l => l.id === this.props.click.layer);
                if (layer && layer.role === LayerRole.USERLAYER && layer.type === "vector" && !isEmpty(layer.features)) {
                    queryFeature = layer.features.find(feature =>  feature.id === this.props.click.feature);
                    if (queryFeature && !isEmpty(queryFeature.properties)) {
                        identifyResults[layer.name] = [queryFeature];
                    }
                }
            }
            this.props.addMarker('identify', clickPoint, '', this.props.map.projection);
            this.setState({identifyResults: identifyResults, pendingRequests: pendingRequests});
        }
    }
    queryPoint = (prevProps) => {
        if (this.props.click.button !== 0 || this.props.click === prevProps.click || this.props.click.feature === "startupposmarker") {
            return null;
        }
        if (this.props.click.feature === 'searchmarker' && this.props.click.geometry && this.props.click.geomType === 'Point') {
            return this.props.click.geometry;
        }
        return this.props.click.coordinate;
    }
    identifyRegion = (prevProps) => {
        if (!this.props.selection.polygon || this.props.selection === prevProps.selection) {
            return;
        }
        const poly = this.props.selection.polygon;
        const queryableLayers = IdentifyUtils.getQueryLayers(this.props.layers, this.props.map);
        if (poly.length < 1 || isEmpty(queryableLayers)) {
            return;
        }
        const identifyResults = this.props.click.modifiers.ctrl !== true ? {} : this.state.identifyResults;
        this.props.changeSelectionState({reset: true});
        const geometry = {
            type: "Polygon",
            coordinates: [poly]
        };
        const center = [0, 0];
        poly.forEach(point => {
            center[0] += point[0];
            center[1] += point[1];
        });
        center[0] /= poly.length;
        center[1] /= poly.length;

        const filter = stringify(geometry);
        let pendingRequests = 0;
        const params = {...this.props.params};
        if (this.props.params.region_feature_count) {
            params.feature_count = this.props.params.region_feature_count;
            delete params.region_feature_count;
        }
        queryableLayers.forEach(layer => {
            const request = IdentifyUtils.buildFilterRequest(layer, layer.queryLayers.join(","), filter, this.props.map, this.props.params);
            ++pendingRequests;
            axios.get(request.url, {params: request.params}).then((response) => {
                this.setState({pendingRequests: this.state.pendingRequests - 1});
                this.parseResult(response.data, layer, request.params.info_format, center);
            }).catch((e) => {
                console.log(e);
                this.setState({pendingRequests: this.state.pendingRequests - 1});
            });
            this.setState({identifyResults: identifyResults, pendingRequests: pendingRequests});
        });
    }
    parseResult = (response, layer, format, clickPoint) => {
        const newResults = IdentifyUtils.parseResponse(response, layer, format, clickPoint, this.props.map.projection, this.props.featureInfoReturnsLayerName, this.props.layers);
        // Merge with previous
        const identifyResults = {...this.state.identifyResults};
        Object.keys(newResults).map(layername => {
            const newFeatureIds = newResults[layername].map(feature => feature.id);
            identifyResults[layername] = [
                ...(identifyResults[layername] || []).filter(feature => !newFeatureIds.includes(feature.id)),
                ...newResults[layername]
            ];
        });
        this.setState({identifyResults: identifyResults});
    }
    onShow = (mode) => {
        this.setState({mode: mode || 'Point'});
        if (mode === "Region") {
            this.props.changeSelectionState({geomType: 'Polygon'});
        }
    }
    onToolClose = () => {
        this.props.removeMarker('identify');
        this.props.removeLayer("identifyslection");
        this.props.changeSelectionState({geomType: undefined});
        this.setState({identifyResults: null, pendingRequests: 0, mode: 'Point'});
    }
    identifyClearResults = () => {
        this.props.removeMarker('identify');
        this.props.removeLayer("identifyslection");
        this.setState({identifyResults: null, pendingRequests: 0});
    }
    plotInfoToolClearResults = function(){
        this.props.setCurrentTask(null);
    }
    clearResults = function(){
        this.identifyClearResults();
        this.plotInfoToolClearResults();
    }
    plotInfoToolRenderBody = function(){
        if(this.state.plotInfo){
            const plotServiceUrl = ConfigUtils.getConfigProp("plotInfoService").replace(/\/$/, '');
            const plot = this.state.plotInfo[this.state.currentPlot];
            return (
                <div className="plot-info-dialog-body" role="body">
                    <div className="plot-info-dialog-header">
                        {this.state.plotInfo.map((entry, idx) => ([(
                            <div className="plot-info-result-header" key={"result-header-" + idx} onClick={() => this.toggleCurrentPlot(idx)}>
                                <Icon icon={this.state.currentPlot === idx ? "collapse" : "expand"} />
                                <span>{entry.label}</span>
                            </div>
                        ), this.state.currentPlot !== idx ? null : (
                            <div className="plot-info-result-body" key={"result-body-" + idx}>
                                <table><tbody>
                                    {plot.fields.map(e => (
                                        <tr key={e.key}>
                                            <td dangerouslySetInnerHTML={{__html: e.key}} />
                                            <td><div dangerouslySetInnerHTML={{__html: e.value}} /></td>
                                        </tr>
                                    ))}
                                </tbody></table>
                            </div>
                        )]))}
                    </div>
                    <div className="plot-info-dialog-queries">
                        {this.props.infoQueries.map((entry) => {
                            let query = entry.query.replace('$egrid$', plot.egrid);
                            if (!query.startsWith('http')) {
                                query = plotServiceUrl + query;
                            }
                            const pdfQuery = entry.pdfQuery ? plotServiceUrl + entry.pdfQuery.replace('$egrid$', plot.egrid) : null;
                            const pdfTooltip = entry.pdfTooltip ? LocaleUtils.tr(entry.pdfTooltip) : "";
                            const expanded = this.state.expandedInfo === entry.key;
                            return [
                                (
                                    <div className="plot-info-dialog-query-title" key={entry.key + "-title"} onClick={() => this.toggleEgridInfo(entry, query)}>
                                        <Icon icon={expanded ? "collapse" : "expand"} />
                                        <span>{entry.titleMsgId ? LocaleUtils.tr(entry.titleMsgId) : entry.title}</span>
                                        {entry.pdfQuery ?
                                            this.state.pendingPdfs.includes(pdfQuery) ? (<Spinner />) :
                                            (<Icon title={pdfTooltip} icon="pdf" onClick={ev => this.queryPdf(ev, entry, pdfQuery)} />)
                                        : null}
                                    </div>
                                ),
                                expanded ? (
                                    <div className="plot-info-dialog-query-result" key={entry.key + "-result"}>
                                        {!this.state.expandedInfoData ? this.renderWait() : this.state.expandedInfoData.failed ? this.renderError() : this.renderInfoData()}
                                    </div>
                                ) : null
                            ];
                        })}
                    </div>
                </div>
            );
        } else {
            return null
        }
        
    }
    toggleCurrentPlot = (idx) => {
        if (this.state.currentPlot !== idx) {
            this.setState({currentPlot: idx, expandedInfo: null, expandedInfoData: null, pendingPdfs: []});
        }
    }
    renderWait = () => {
        return (
            <div className="plot-info-dialog-query-loading">
                <Spinner />
                <span>{LocaleUtils.tr("plotinfotool.loading")}</span>
            </div>
        );
    }
    renderError = () => {
        return (
            <div className="plot-info-dialog-query-failed">
                {this.state.expandedInfoData.failed === true ? LocaleUtils.tr("plotinfotool.failed") : LocaleUtils.tr(this.state.expandedInfoData.failed)}
            </div>
        );
    }
    renderInfoData = () => {
        if (this.props.customInfoComponents[this.state.expandedInfo]) {
            const Component = this.props.customInfoComponents[this.state.expandedInfo];
            const config = (this.props.infoQueries.find(entry => entry.key === this.state.expandedInfo) || {}).cfg || {};
            return (<Component config={config} data={this.state.expandedInfoData} />);
        } else {
            const assetsPath = ConfigUtils.getAssetsPath();
            const src = assetsPath + "/templates/blank.html";
            return (
                <iframe onLoad={ev => this.setIframeContent(ev.target, this.state.expandedInfoData)} src={src} />
            );
        }
    }
    setIframeContent = (iframe, html) => {
        if (!iframe.getAttribute("identify-content-set")) {
            iframe.setAttribute("identify-content-set", true);
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            doc.open();
            doc.write(html);
            doc.close();
        }
    }
    activated = () => {
        const assetsPath = ConfigUtils.getAssetsPath();
        this.props.changeSelectionState({geomType: 'Point', style: 'default', styleOptions: {
            fillColor: [0, 0, 0, 0],
            strokeColor: [0, 0, 0, 0]
        }, cursor: 'url("' + assetsPath + '/img/plot-info-marker.png") 12 12, default'});
        this.props.themeLayerRestorer(this.props.toolLayers, null, layers => {
            this.props.addThemeSublayer({sublayers: layers});
        });
    }
    deactivated = () => {
        this.setState({plotInfo: null, currentPlot: null, expandedInfo: null, expandedInfoData: null, pendingPdfs: []});
        this.props.changeSelectionState({geomType: null});
    }
    queryBasicInfoAtPoint = (point) => {
        this.props.clearSearch();
        const serviceUrl = ConfigUtils.getConfigProp("plotInfoService").replace(/\/$/, '') + '/';
        const params = {
            x: point[0],
            y: point[1]
        };
        axios.get(serviceUrl, {params}).then(response => {
            const plotInfo = !isEmpty(response.data.plots) ? response.data.plots : null;
            this.setState({plotInfo: plotInfo, currentPlot: 0, expandedInfo: null, expandedInfoData: null});
        }).catch(() => {});
    }
    queryInfoByEgrid = (query, egrid) => {
        const serviceUrl = ConfigUtils.getConfigProp("plotInfoService").replace(/\/$/, '');
        axios.get(serviceUrl + '/query/' + egrid).then(response => {
            const plotInfo = !isEmpty(response.data.plots) ? response.data.plots : null;
            this.setState({plotInfo: plotInfo, currentPlot: 0, expandedInfo: null, expandedInfoData: null});
            if (plotInfo) {
                const bounds = CoordinatesUtils.reprojectBbox(plotInfo[0].bbox, 'EPSG:2056', this.props.map.projection);
                const zoom = MapUtils.getZoomForExtent(bounds, this.props.map.resolutions, this.props.map.size, 0, this.props.map.scales.length - 1) - 1;
                this.props.zoomToPoint([0.5 * (bounds[0] + bounds[2]), 0.5 * (bounds[1] + bounds[3])], zoom, 'EPSG:2056');
                const url = serviceUrl + query.query.replace('$egrid$', egrid);
                this.toggleEgridInfo(query, url);
            }
        }).catch(e => {
            alert("Query failed");
            console.warn(e);
        });
    }
    queryPdf = (ev, infoEntry, queryUrl) => {
        this.props.logAction("PLOTINFO_PDF_QUERY", {info: infoEntry.key});
        ev.stopPropagation();
        this.setState({pendingPdfs: [...this.state.pendingPdfs, queryUrl]});
        axios.get(queryUrl, {responseType: 'blob', validateStatus: status => status >= 200 && status < 300 && status !== 204}).then(response => {
            const contentType = response.headers["content-type"];
            let filename = infoEntry.key + '.pdf';
            try {
                const contentDisposition = response.headers["content-disposition"];
                filename = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition)[1];
            } catch (e) {
                /* Pass */
            }
            FileSaver.saveAs(new Blob([response.data], {type: contentType}), filename);
            this.setState({pendingPdfs: this.state.pendingPdfs.filter(entry => entry !== queryUrl)});
        }).catch(() => {
            this.setState({pendingPdfs: this.state.pendingPdfs.filter(entry => entry !== queryUrl)});
            const errorMsg = infoEntry.failMsgId ? LocaleUtils.tr(infoEntry.failMsgId) : "";
            alert(errorMsg || "Print failed");
        });
    }
    toggleEgridInfo = (infoEntry, queryUrl) => {
        if (this.state.expandedInfo === infoEntry.key) {
            this.setState({expandedInfo: null, expandedInfoData: null});
        } else {
            this.props.logAction("PLOTINFO_QUERY", {info: infoEntry.key});
            this.setState({expandedInfo: infoEntry.key, expandedInfoData: null});
            axios.get(queryUrl).then(response => {
                this.setState({expandedInfoData: response.data || {failed: infoEntry.failMsgId || true}});
            }).catch(() => {
                this.setState({expandedInfoData: {failed: infoEntry.failMsgId || true}});
            });
        }
    }
    render() {
        let resultWindow = null;
        if (this.state.pendingRequests > 0 || this.state.identifyResults !== null) {
            let body = null;
            if (isEmpty(this.state.identifyResults)) {
                if (this.state.pendingRequests > 0) {
                    body = (<div className="identify-body" role="body"><span className="identify-body-message">{LocaleUtils.tr("identify.querying")}</span></div>);
                } else {
                    body = (<div className="identify-body" role="body"><span className="identify-body-message">{LocaleUtils.tr("identify.noresults")}</span></div>);
                }
            } else {
                body = (
                    <IdentifyViewer
                        attributeCalculator={this.props.attributeCalculator}
                        attributeTransform={this.props.attributeTransform}
                        displayResultTree={this.props.displayResultTree}
                        enableExport={this.props.enableExport}
                        identifyResults={this.state.identifyResults}
                        iframeDialogsInitiallyDocked={this.props.iframeDialogsInitiallyDocked}
                        longAttributesDisplay={this.props.longAttributesDisplay}
                        role="body" />
                );
            }
            resultWindow = (
                <ResizeableWindow icon="info-sign"
                    initialHeight={this.props.initialHeight} initialWidth={this.props.initialWidth}
                    initialX={0} initialY={0} initiallyDocked={this.props.initiallyDocked}
                    key="IdentifyWindow"
                    onClose={this.clearResults.bind(this)} title={LocaleUtils.trmsg("identify.title")} zIndex={8}
                >
                    <Tabs role="body">
                        <TabList>
                            <Tab>Feature-Info</Tab>
                            <Tab>Grundstücksinfo</Tab>
                        </TabList>

                        <TabPanel>
                            {body}
                        </TabPanel>
                        <TabPanel>
                            {this.plotInfoToolRenderBody()}
                        </TabPanel>
                    </Tabs>
                    
                </ResizeableWindow>
            );
        }
        return [resultWindow, (
            <TaskBar key="IdentifyTaskBar" onHide={this.onToolClose} onShow={this.onShow} task="Identify">
                {() => ({
                    body: this.state.mode === "Region" ? LocaleUtils.tr("infotool.clickhelpPolygon") : LocaleUtils.tr("infotool.clickhelpPoint")
                })}
            </TaskBar>
        )];
    }
}

const selector = (state) => ({
    click: state.map.click || {},
    currentTask: state.task.id,
    currentIdentifyTool: state.identify.tool,
    layers: state.layers.flat,
    map: state.map,
    selection: state.selection,
    theme: state.theme.current,
});

export default connect(selector, {
    addMarker: addMarker,
    changeSelectionState: changeSelectionState,
    removeMarker: removeMarker,
    removeLayer: removeLayer,
    setCurrentTask: setCurrentTask,
    addThemeSublayer: addThemeSublayer,
    addLayerFeatures: addLayerFeatures,
    zoomToPoint: zoomToPoint,
    clearSearch: clearSearch,
    logAction: logAction
})(PlotInfoTool);
