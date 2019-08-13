/**
 * Copyright 2019, Sourcepole AG.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

const React = require('react');
const PropTypes = require('prop-types');
const {connect} = require('react-redux');
const isEmpty = require('lodash.isempty');
const axios = require('axios');
const FileSaver = require('file-saver');
const xml2js = require('xml2js');
const ConfigUtils = require('qwc2/utils/ConfigUtils');
const {changeSelectionState} = require('qwc2/actions/selection');
const {setCurrentTask} = require('qwc2/actions/task');
const {LayerRole, addThemeSublayer, addLayerFeatures, removeLayer} = require('qwc2/actions/layers');
const Message = require("qwc2/components/I18N/Message");
const ResizeableWindow = require('qwc2/components/ResizeableWindow');
const Spinner = require('qwc2/components/Spinner');
const Icon = require('qwc2/components/Icon');
const {zoomToExtent} = require('qwc2/actions/map');
const {UrlParams} = require("qwc2/utils/PermaLinkUtils");
const VectorLayerUtils = require('qwc2/utils/VectorLayerUtils');
const OerebDocument = require('../components/OerebDocument');
require('./style/PlotInfoTool.css');


class PlotInfoTool extends React.Component {
    static propTypes = {
        theme: PropTypes.object,
        toolLayers: PropTypes.array,
        selection: PropTypes.object,
        map: PropTypes.object,
        windowSize: PropTypes.object,
        currentTask: PropTypes.string,
        changeSelectionState: PropTypes.func,
        setCurrentTask: PropTypes.func,
        addThemeSublayer: PropTypes.func,
        addLayerFeatures: PropTypes.func,
        removeLayer: PropTypes.func,
        zoomToExtent: PropTypes.func,
        themeLayerRestorer: PropTypes.func,
        oerebQueryFormat: PropTypes.string
    }
    static defaultProps = {
        toolLayers: [],
        infoQueries: [],
        windowSize: {width: 500, height: 800},
        oerebQueryFormat: "json"
    }
    state = {
        plotInfo: null,
        currentPlot: null,
        expandedInfo: null,
        expandedInfoData: null,
        pendingPdfs: []
    }
    constructor(props) {
        super(props);
        this.oerebQuery = {
            key: "oereb",
            title: "Öffentlich-rechtliche Eigentumsbeschränkungen",
            query: this.props.oerebQueryFormat === "xml" ? "/oereb/xml/$egrid$" : "/oereb/json/$egrid$",
            pdfQuery: "/oereb/pdf/$egrid$",
            responseTransform: this.props.oerebQueryFormat === "xml" ? this.oerebXmlToJson : null
        };
    }
    componentWillReceiveProps(newProps) {
        if(newProps.theme && !this.props.theme && UrlParams.getParam('oereb_egrid')) {
            this.props.setCurrentTask('PlotInfoTool');
            this.queryBasicInfoByEgrid(UrlParams.getParam('oereb_egrid'));
            UrlParams.updateParams({oereb_egrid: undefined});
        } else if(newProps.currentTask === 'PlotInfoTool' && this.props.currentTask !== 'PlotInfoTool') {
            this.activated();
        } else if(newProps.currentTask !== 'PlotInfoTool' && this.props.currentTask === 'PlotInfoTool') {
            this.deactivated();
        } else if(newProps.currentTask === 'PlotInfoTool' && newProps.selection.point &&
           newProps.selection !== this.props.selection)
        {
            this.queryBasicInfoAtPoint(newProps.selection.point);
        }
    }
    componentDidUpdate(prevState) {
        if(this.state.plotInfo) {
            if(this.state.currentPlot !== prevState.currentPlot) {
                let layer = {
                    id: "plotselection",
                    role: LayerRole.SELECTION
                };
                let wkt = this.state.plotInfo[this.state.currentPlot].geom;
                let feature = VectorLayerUtils.wktToGeoJSON(wkt, "EPSG:2056", this.props.map.projection);
                feature.styleName = 'default';
                feature.styleOptions = {
                    fillColor: [0, 0, 0, 0],
                    strokeColor: [242, 151, 84, 0.75],
                    strokeWidth: 8,
                    strokeDash: []
                }
                this.props.addLayerFeatures(layer, [feature], true);
            }
        } else {
            this.props.removeLayer("plotselection");
        }
    }
    render() {
        if(!this.state.plotInfo || this.state.plotInfo.length === 0) {
            return null;
        }
        return (
            <ResizeableWindow title="appmenu.items.PlotInfoTool" icon="plot_info"
                onClose={() => this.props.setCurrentTask(null)} scrollable={true}
                initialX={0} initialY={0}
                initialWidth={this.props.windowSize.width} initialHeight={this.props.windowSize.height}
            >
                {this.renderBody()}
            </ResizeableWindow>
        );
    }
    renderBody = () => {
        let plotServiceUrl = ConfigUtils.getConfigProp("plotInfoService").replace(/\/$/, '');
        let plot = this.state.plotInfo[this.state.currentPlot];
        let infoQueries = [...this.props.infoQueries, this.oerebQuery];
        return (
            <div role="body" className="plot-info-dialog-body">
                <div className="plot-info-dialog-header">
                    {this.state.plotInfo.map((entry, idx) => ([(
                        <div key={"result-header-" + idx} className="plot-info-result-header" onClick={ev => this.toggleCurrentPlot(idx)}>
                            <Icon icon={this.state.currentPlot === idx ? "collapse" : "expand"} />
                            <span>{entry.label}</span>
                        </div>
                    ), this.state.currentPlot !== idx ? null : (
                        <table key={"result-body-" + idx}><tbody>
                            {plot.fields.map(entry => (
                                <tr key={entry.key}>
                                    <td>{entry.key}</td><td>{entry.value}</td>
                                </tr>
                            ))}
                            <tr>
                                <td>EGRID</td><td>{entry.egrid}</td>
                            </tr>
                        </tbody></table>
                )]))}
                </div>
                <div className="plot-info-dialog-queries">
                    {infoQueries.map((entry,idx) => {
                        let query = plotServiceUrl + entry.query.replace('$egrid$', plot.egrid);
                        let pdfQuery = entry.pdfQuery ? plotServiceUrl + entry.pdfQuery.replace('$egrid$', plot.egrid) : null;
                        return (
                            <div key={entry.key} className="plot-info-dialog-query">
                                <div className="plot-info-dialog-query-title" onClick={() => this.toggleEgridInfo(entry, query)}>
                                    <Icon icon={this.state.expandedInfo === entry.key ? "collapse" : "expand"} />
                                    <span>{entry.title}</span>
                                    {entry.pdfQuery ?
                                        this.state.pendingPdfs.includes(pdfQuery) ? (<Spinner />) :
                                        (<Icon icon="pdf" onClick={ev => this.queryPdf(ev, entry, pdfQuery)} />)
                                     : null}
                                </div>
                                {this.state.expandedInfo === entry.key ? (
                                    <div>
                                        {!this.state.expandedInfoData ? this.renderWait() : this.state.expandedInfoData.failed ? this.renderError() : this.renderInfoData()}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }
    toggleCurrentPlot = (idx) => {
        if(this.state.currentPlot !== idx) {
            this.setState({currentPlot: idx, expandedInfo: null, expandedInfoData: null, pendingPdfs: []});
        }
    }
    renderWait = () => {
        return (
            <div className="plot-info-dialog-query-loading">
                <Spinner />
                <Message msgId="plotinfotool.loading" />
            </div>
        );
    }
    renderError = () => {
        return (
            <div className="plot-info-dialog-query-failed">
                <Message msgId="plotinfotool.failed" />
            </div>
        );
    }
    renderInfoData = () => {
        if(this.state.expandedInfo === 'oereb') {
            return (<OerebDocument oerebDoc={this.state.expandedInfoData} />);
        } else {
            let assetsPath = ConfigUtils.getConfigProp("assetsPath");
            let src = assetsPath + "/templates/blank.html";
            return (
                <iframe className="plot-info-dialog-query-result" src={src} onLoad={ev => this.setIframeContent(ev.target, this.state.expandedInfoData)}></iframe>
            );
        }
        return null;
    }
    setIframeContent = (iframe, html) => {
        if(!iframe.getAttribute("identify-content-set")) {
            iframe.setAttribute("identify-content-set", true);
            let doc = iframe.contentDocument || iframe.contentWindow.document;
            doc.open();
            doc.write(html);
            doc.close();
        }
    }
    activated = () => {
        let assetsPath = ConfigUtils.getConfigProp("assetsPath");
        this.props.changeSelectionState({geomType: 'Point', style: 'marker', styleOptions: {
            iconSrc: assetsPath + '/img/plot-info-marker.png',
            iconAnchor: [0.5, 0.5]
        }, cursor: 'url("' + assetsPath + '/img/plot-info-cursor.png") 12 12, default'});
        this.props.themeLayerRestorer(this.props.toolLayers, null, layers => {
            this.props.addThemeSublayer({sublayers: layers});
        });
    }
    deactivated = () => {
        this.setState({plotInfo: null, currentPlot: null, expandedInfo: null, expandedInfoData: null, pendingPdfs: []});
        this.props.changeSelectionState({geomType: null});
    }
    queryBasicInfoAtPoint = (point) => {
        let serviceUrl = ConfigUtils.getConfigProp("plotInfoService").replace(/\/$/, '') + '/';
        let params = {
            x: point[0],
            y: point[1]
        };
        axios.get(serviceUrl, {params}).then(response => {
            let plotInfo = !isEmpty(response.data.plots) ? response.data.plots : null
            this.setState({plotInfo: plotInfo, currentPlot: 0, expandedInfo: null, expandedInfoData: null});
        }).catch(e => {});
    }
    queryBasicInfoByEgrid = (egrid) => {
        const serviceUrl = ConfigUtils.getConfigProp("plotInfoService").replace(/\/$/, '');
        axios.get(serviceUrl + '/query/' + egrid).then(response => {
            let plotInfo = !isEmpty(response.data.plots) ? response.data.plots : null
            this.setState({plotInfo: plotInfo, currentPlot: 0, expandedInfo: null, expandedInfoData: null});
            if(plotInfo) {
                this.props.zoomToExtent(plotInfo[0].bbox, 'EPSG:2056');
                let query = serviceUrl + this.oerebQuery.query.replace('$egrid$', egrid);
                this.toggleEgridInfo(this.oerebQuery, query);
            }
        }).catch(e => {
            alert("Query failed");
            console.warn(e);
        });
    }
    queryPdf = (ev, infoEntry, queryUrl) => {
        ev.stopPropagation();
        this.setState({pendingPdfs: [...this.state.pendingPdfs, queryUrl]});
        axios.get(queryUrl).then(response => {
            let contentType = response.headers["content-type"];
            FileSaver.saveAs(new Blob([response.data], {type: contentType}), infoEntry.title + '.pdf');
            this.setState({pendingPdfs: this.state.pendingPdfs.filter(entry => entry !== queryUrl)});
        }).catch(e => {
            this.setState({pendingPdfs: this.state.pendingPdfs.filter(entry => entry !== queryUrl)});
            alert("Print failed");
        });
    }
    toggleEgridInfo = (infoEntry, queryUrl) => {
        if(this.state.expandedInfo === infoEntry.key) {
            this.setState({expandedInfo: null, expandedInfoData: null});
        } else {
            this.setState({expandedInfo: infoEntry.key, expandedInfoData: null});
            axios.get(queryUrl).then(response => {
                let data = infoEntry.responseTransform ? infoEntry.responseTransform(response.data) : response.data;
                this.setState({expandedInfoData: data});
            }).catch(e => {
                this.setState({expandedInfoData: {"failed": true}});
            });
        }
    }
    oerebXmlToJson = (xml) => {
        let json;
        let options = {
            tagNameProcessors: [xml2js.processors.stripPrefix],
            valueProcessors: [(text) => decodeURIComponent(text)],
            explicitArray: false
        };
        xml2js.parseString(xml, options, (err, result) => {
            json = result;
        });
        // Case sensitivity difference between XML and JSON
        json.GetExtractByIdResponse.extract = json.GetExtractByIdResponse.Extract;
        return json;
    }
};

const selector = state => ({
    selection: state.selection,
    map: state.map,
    theme: state.theme.current,
    currentTask: state.task.id
});

module.exports = {
    PlotInfoToolPlugin: connect(
        selector,
        {
            changeSelectionState: changeSelectionState,
            setCurrentTask: setCurrentTask,
            addThemeSublayer: addThemeSublayer,
            addLayerFeatures: addLayerFeatures,
            removeLayer: removeLayer,
            zoomToExtent: zoomToExtent
        }
    )(PlotInfoTool),
    reducers: {
        selection: require('qwc2/reducers/selection')
    }
};
