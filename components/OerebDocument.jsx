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
const assign = require('object-assign');
const isEmpty = require('lodash.isempty');
const uuid = require('uuid');
const url = require('url');
const xml2js = require('xml2js');
const {LayerRole, addLayer, removeLayer, changeLayerProperties} = require('qwc2/actions/layers');
const LayerUtils = require('qwc2/utils/LayerUtils');
const Icon = require('qwc2/components/Icon');
const Message = require("qwc2/components/I18N/Message");
require('./style/OerebDocument.css');

const DataNS = "http://schemas.geo.admin.ch/V_D/OeREB/1.0/ExtractData";
const Lang = "de";

class OerebDocument extends React.Component {
    static propTypes = {
        layers: PropTypes.array,
        oerebDoc: PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.object
        ]),
        addLayer: PropTypes.func,
        removeLayer: PropTypes.func,
        changeLayerProperties: PropTypes.func,
        config: PropTypes.object
    }
    state = {
        oerebDoc: null,
        expandedSection: null,
        expandedTheme: null,
        expandedLegend: null
    }
    constructor(props) {
        super(props);
        this.state.oerebDoc = this.getOerebDoc(props.data);
    }
    componentWillReceiveProps(newProps) {
        this.setState({oerebDoc: this.getOerebDoc(newProps.data)});
    }
    componentWillUnmount() {
        this.removeHighlighLayer();
    }
    getOerebDoc(oerebDoc) {
        if(typeof oerebDoc === "object") {
            return this.props.oerebDoc;
        } else {
            let json;
            let options = {
                tagNameProcessors: [xml2js.processors.stripPrefix],
                valueProcessors: [(text) => decodeURIComponent(text)],
                explicitArray: false
            };
            xml2js.parseString(oerebDoc, options, (err, result) => {
                json = result;
            });
            // Case sensitivity difference between XML and JSON
            json.GetExtractByIdResponse.extract = json.GetExtractByIdResponse.Extract;
            return json;
        }
    }
    render() {
        let extract = this.state.oerebDoc.GetExtractByIdResponse.extract;
        return (
            <div className="oereb-document">
                {this.renderSection("concernedThemes", this.renderConcernedThemes, this.ensureArray(extract.ConcernedTheme))}
                {this.renderSection("notConcernedThemes", this.renderOtherThemes, this.ensureArray(extract.NotConcernedTheme))}
                {this.renderSection("themeWithoutData", this.renderOtherThemes, this.ensureArray(extract.ThemeWithoutData))}
                {this.renderSection("generalInformation", this.renderGeneralInformation, extract)}
            </div>
        );
    }
    renderSection = (name, renderer, data) => {
        if(isEmpty(data)) {
            return null;
        }
        let icon = this.state.expandedSection === name ? 'chevron-up' : 'chevron-down';
        return (
            <div className="oereb-document-section">
                <div className="oereb-document-section-title" onClick={ev => this.toggleSection(name)}>
                    <Message msgId={"oereb." + name} />
                    <span>{data.length}&nbsp;<Icon icon={icon} /></span>
                </div>
                {this.state.expandedSection === name ? renderer(data) : null}
            </div>
        );
    }
    renderConcernedThemes = (themes) => {
        return (
            <div className="oereb-document-section-concerned-themes">
                {themes.map(theme => {
                    let icon = this.state.expandedTheme === theme.Code ? 'chevron-up' : 'chevron-down';
                    return (
                        <div className="oereb-document-theme" key={theme.Code}>
                            <div className="oereb-document-theme-title" onClick={ev => this.toggleTheme(theme.Code)}>
                                <span>{this.localizedText(theme.Text)}</span><Icon icon={icon} />
                            </div>
                            {this.state.expandedTheme === theme.Code ? this.renderTheme(theme.Code) : null}
                        </div>
                    );
                })}
            </div>
        )
    }
    collectConcernedThemes = (landOwnRestr, name) => {
        let subthemes = [""];
        let entries = landOwnRestr.filter(entry => entry.Theme.Code === name);
        let isSubTheme = false;
        if(!isEmpty(entries)) {
            // Main theme match, order subthemes according to config
            subthemes = (this.props.config.subthemes || {})[name] || [""];
            entries = entries.sort((x, y) => subthemes.indexOf(x.SubTheme) - subthemes.indexOf(y.SubTheme));
        } else {
            // Attempt to match by subtheme name
            entries = landOwnRestr.filter(entry => entry.SubTheme === name);
            if(!isEmpty(entries)) {
                subthemes = [name];
                isSubTheme = true;
            }
        }
        return {entries, subthemes, isSubTheme};
    }
    renderTheme = (name) => {
        let extract = this.state.oerebDoc.GetExtractByIdResponse.extract;
        let landOwnRestr = this.ensureArray(extract.RealEstate.RestrictionOnLandownership);
        let {entries, subthemes, isSubTheme} = this.collectConcernedThemes(landOwnRestr, name);
        let regulations = {};
        let legalbasis = {};
        let respoffices = {};
        for(let entry of entries) {
            for(let prov of this.ensureArray(entry.LegalProvisions)) {
                regulations[this.localizedText(prov.TextAtWeb)] = {
                    label: this.localizedText(prov.Title) + (prov.OfficialNumber ? ", " + prov.OfficialNumber : ""),
                    link: this.localizedText(prov.TextAtWeb)
                };
                for(let ref of this.ensureArray(prov.Reference)) {
                    legalbasis[this.localizedText(ref.TextAtWeb)] = {
                        label: this.localizedText(ref.Title) + " (" + this.localizedText(ref.Abbreviation) + ")" + (ref.OfficialNumber ? ", " + ref.OfficialNumber : ""),
                        link: this.localizedText(ref.TextAtWeb)
                    };
                }
                respoffices[prov.ResponsibleOffice.OfficeAtWeb] = {
                    label: this.localizedText(prov.ResponsibleOffice.Name),
                    link: prov.ResponsibleOffice.OfficeAtWeb
                }
            }
        }

        let legendSymbols = {};
        for(let entry of entries) {
            let subTheme = entry.SubTheme || "";
            if(!(subTheme in legendSymbols)) {
                legendSymbols[subTheme] = {
                    symbols: {},
                    fullLegend: (entry.Map || {}).LegendAtWeb
                };
            }
            let subThemeSymbols = legendSymbols[subTheme].symbols;
            if(entry.SymbolRef in subThemeSymbols) {
                if(subThemeSymbols[entry.SymbolRef].AreaShare && entry.AreaShare) {
                    subThemeSymbols[entry.SymbolRef].AreaShare += this.ensureNumber(entry.AreaShare);
                } else if(entry.AreaShare) {
                    subThemeSymbols[entry.SymbolRef].AreaShare = this.ensureNumber(entry.AreaShare);
                }
                if(subThemeSymbols[entry.SymbolRef].LengthShare && entry.LengthShare) {
                    subThemeSymbols[entry.SymbolRef].LengthShare += this.ensureNumber(entry.LengthShare);
                } else if(entry.LengthShare) {
                    subThemeSymbols[entry.SymbolRef].LengthShare = this.ensureNumber(entry.LengthShare);
                }
                if(subThemeSymbols[entry.SymbolRef].PartInPercent && entry.PartInPercent) {
                    subThemeSymbols[entry.SymbolRef].PartInPercent += this.ensureNumber(entry.PartInPercent);
                } else if(entry.PartInPercent) {
                    subThemeSymbols[entry.SymbolRef].PartInPercent = this.ensureNumber(entry.PartInPercent);
                }
            } else {
                subThemeSymbols[entry.SymbolRef] = {
                    Information:entry.Information,
                    AreaShare: this.ensureNumber(entry.AreaShare),
                    LengthShare: this.ensureNumber(entry.LengthShare),
                    PartInPercent: this.ensureNumber(entry.PartInPercent)
                };
            }
        }
        return (
            <div className="oereb-document-theme-contents">
                {subthemes.slice(0).reverse().map((subtheme, idx) => {
                    let subthemedata = legendSymbols[subtheme];
                    if(!subthemedata) {
                        return (
                            <div key={"subtheme" + idx} className="oereb-document-subtheme-container">
                                <div className="oereb-document-subtheme-emptytitle">{subtheme}</div>
                            </div>
                        );
                    }
                    let fullLegendId = this.state.expandedTheme + "_" + (subtheme || "");
                    let toggleLegendMsgId = this.state.expandedLegend === fullLegendId ? "oereb.hidefulllegend" : "oereb.showfulllegend";
                    let subThemeLayer = this.props.layers.find(layer => layer.__oereb_subtheme === subtheme);
                    const hasLengthShare = Object.entries(subthemedata.symbols).find(([symbol, data]) => data.LengthShare) !== undefined;
                    return (
                        <div key={"subtheme" + idx} className="oereb-document-subtheme-container">
                            {subtheme && !isSubTheme ? (<div className="oereb-document-subtheme-title">
                                {subThemeLayer ? (<Icon icon={subThemeLayer.visibility === true ? 'checked' : 'unchecked'} onClick={() => this.toggleThemeLayer(subThemeLayer)}/>) : null}
                                {subtheme}
                            </div>) : null}
                            <table><tbody>
                                <tr>
                                    <th><Message msgId="oereb.type" /></th>
                                    <th></th>
                                    <th><Message msgId={hasLengthShare ? 'oereb.length' : 'oereb.area'} /></th>
                                    <th><Message msgId="oereb.perc" /></th>
                                </tr>
                                {Object.entries(subthemedata.symbols).map(([symbol, data],jdx) => (
                                    <tr key={"leg" + jdx}>
                                        <td>{this.localizedText(data.Information)}</td>
                                        <td><img src={symbol} /></td>
                                        {data.AreaShare ? (<td>{data.AreaShare}&nbsp;m<sup>2</sup></td>) : ( data.LengthShare ? (<td>{data.LengthShare}&nbsp;m</td>) : (<td>-</td>) )}
                                        {data.PartInPercent ? (<td>{data.PartInPercent.toFixed(2) + "%"}</td>) : (<td>-</td>)}
                                    </tr>
                                ))}
                            </tbody></table>
                        {subthemedata.fullLegend ? (
                            <div>
                                <div className="oereb-document-toggle-fulllegend" onClick={ev => this.toggleFullLegend(fullLegendId)}><a><Message msgId={toggleLegendMsgId} /></a></div>
                                {this.state.expandedLegend === fullLegendId ? (<div className="oereb-document-fulllegend"><img src={subthemedata.fullLegend} /></div>) : null}
                            </div>
                        ) : null}
                        </div>
                    );
                })}
                <h1><Message msgId="oereb.regulations" /></h1>
                <ul>
                    {Object.values(regulations).map((reg,idx) => (
                        <li key={"reg" + idx}><a target="_blank" href={reg.link} title={reg.label}>&#128279; {reg.label}</a></li>
                    ))}
                </ul>
                <h1><Message msgId="oereb.legalbasis" /></h1>
                <ul>
                    {Object.values(legalbasis).map((leg, idx) => (
                        <li key={"leg" + idx}><a target="_blank" href={leg.link} title={leg.label}>&#128279; {leg.label}</a></li>
                    ))}
                </ul>
                <h1><Message msgId="oereb.responsibleoffice" /></h1>
                <ul>
                    {Object.values(respoffices).map((rof, idx) => (
                        <li key={"rof" + idx}><a target="_blank" href={rof.link} title={rof.label}>&#128279; {rof.label}</a></li>
                    ))}
                </ul>
            </div>
        );
    }
    renderOtherThemes = (themes) => {
        return (
            <div className="oereb-document-section-other-themes">
                {themes.map(theme => (<div key={theme.Code}>{this.localizedText(theme.Text)}</div>))}
            </div>
        );
    }
    renderGeneralInformation = (extract) => {
        return (
            <div className="oereb-document-section-general-info">
                <h1><Message msgId="oereb.responsibleauthority" /></h1>
                <table><tbody>
                    <tr>
                        <td rowSpan="4" style={{verticalAlign: 'top'}}><img src={extract.CantonalLogoRef} /></td>
                        <td><b>{this.localizedText(extract.PLRCadastreAuthority.Name)}</b></td>
                    </tr>
                    <tr>
                        <td>{extract.PLRCadastreAuthority.Street} {extract.PLRCadastreAuthority.Number}</td>
                    </tr>
                    <tr>
                        <td>{extract.PLRCadastreAuthority.PostalCode} {extract.PLRCadastreAuthority.City}</td>
                    </tr>
                    <tr>
                        <td><a target="_blank" href={extract.PLRCadastreAuthority.OfficeAtWeb}>{extract.PLRCadastreAuthority.OfficeAtWeb}</a></td>
                    </tr>
                </tbody></table>
                <h1><Message msgId="oereb.fundations" /></h1>
                <p>{this.localizedText(extract.BaseData)}</p>
                <h1><Message msgId="oereb.generalinfo" /></h1>
                <p>{this.localizedText(extract.GeneralInformation)}</p>
                {this.ensureArray(extract.ExclusionOfLiability).map((entry, idx) => [
                    (<h1 key={"disclt" + idx}>{this.localizedText(entry.Title)}</h1>),
                    (<p key={"disclc" + idx}>{this.localizedText(entry.Content)}</p>)
                ])}
            </div>
        );
    }
    toggleSection = (name) => {
        this.setState({
            expandedSection: this.state.expandedSection === name ? null : name,
            expandedTheme: null,
            expandedLegend: null
        });
        this.removeHighlighLayer();
    }
    removeHighlighLayer = () => {
        // Remove previous __oereb_highlight layers
        let layers = this.props.layers.filter(layer => layer.__oereb_highlight === true);
        for(let layer of layers) {
            this.props.removeLayer(layer.id);
        }
    }
    toggleTheme = (name) => {
        let expandedTheme = this.state.expandedTheme === name ? null : name;
        this.setState({
            expandedTheme: expandedTheme,
            expandedLegend: null
        });
        this.removeHighlighLayer();
        if(!expandedTheme) {
            return;
        }

        let extract = this.state.oerebDoc.GetExtractByIdResponse.extract;
        let landOwnRestr = extract.RealEstate.RestrictionOnLandownership;

        let {entries, subthemes, isSubTheme} = this.collectConcernedThemes(landOwnRestr, name);
        let subThemeLayers = new Set();
        for(let entry of entries) {
            if(!entry.Map || !entry.Map.ReferenceWMS || subThemeLayers.has(entry.SubTheme)) {
                continue;
            }
            let parts = url.parse(entry.Map.ReferenceWMS, true);
            let baseUrl = parts.protocol + '//' + parts.host + parts.pathname;
            let params = parts.query;
            let layer = {
                id: name + Date.now().toString(),
                role: LayerRole.USERLAYER,
                type: "wms",
                name: name,
                title: this.localizedText(entry.Theme.Text),
                legendUrl: baseUrl,
                url: baseUrl,
                version: params.VERSION,
                featureInfoUrl: baseUrl,
                queryable: false,
                boundingBox: params.BBOX,
                visibility: true,
                opacity: 255,
                format: params.FORMAT,
                params: {LAYERS: params.LAYERS},
                __oereb_highlight: true,
                __oereb_subtheme: entry.SubTheme
            };
            this.props.addLayer(layer);
            subThemeLayers.add(entry.SubTheme);
        }
    }
    toggleFullLegend = (legendId) => {
        let expandedLegend = this.state.expandedLegend === legendId ? null : legendId;
        this.setState({expandedLegend});
    }
    toggleThemeLayer = (subthemelayer) => {
        let newlayer = assign({}, subthemelayer, {visibility: !subthemelayer.visibility});
        this.props.changeLayerProperties(subthemelayer.uuid, newlayer);
    }
    localizedText = (el) => {
        if(isEmpty(el)) {
            return "";
        }
        if(el.LocalisedText) {
            el = el.LocalisedText;
        }
        if(Array.isArray(el)) {
            let entry = el.find(entry => entry.Language === Lang);
            return entry ? entry.Text : el[0].Text;
        } else {
            return el.Text;
        }
    }
    ensureArray = (el) => {
        return el === undefined ? [] : Array.isArray(el) ? el : [el];
    }
    ensureNumber = (value) => {
        return parseFloat(value) || 0;
    }
};

module.exports = connect(state => ({
    layers: state.layers.flat
}), {
    addLayer: addLayer,
    removeLayer: removeLayer,
    changeLayerProperties: changeLayerProperties
})(OerebDocument);
