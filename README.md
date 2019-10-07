Extra components for QWC2
=========================

This repository contains extra components for QWC2.

PlotInfoTool
------------

Plugin for requesting plot information, including Swiss Public-law Restrictions on landownership (PLR) cadastre.

**`config.json` configuration:**

    [...]
    {
      "name": "PlotInfoTool",
      "cfg": {
        "toolLayers": ["Grundstücke"],
        "infoQueries": [
          {
            "key": "plotdescr",
            "title": "Grundstückbeschrieb",
            "query": "/plot/$egrid$",
            "pdfQuery": null
          }
        ]
      }
    }
    [...]

 * `toolLayers`: List of layers to load when activating tool.
 * `infoQueries`: List of additional info queries to offer in the dialog (PLR cadastre query is built-in).
   - `key`: A unique key name
   - `title`: The human visible title
   - `query`: The query to perform to retreive the info. Must return HTML, which is then rendered in an iframe. `$egrid$` is replaced with the EGRID of the current plot.
   - `pdfQuery`: Optional query to retreive a PDF report, which is then presented as a download the the user. Again, `$egrid$` is replaced with the EGRID of the current plot.
   - `urlKey`: Optional query parameter key name. If QWC2 is started with `<urlKey>=<egrid>` in the URL, the plot info tool is automatically enabled and the respective query performed.

**`appConfig.js` configuration:**

Sample `PlotInfoToolPlugin` configuration, as can be defined in the `cfg` section of `pluginsDef` in `appConfig.js`:

    PlotInfoToolPlugin: {
      themeLayerRestorer: require('./themeLayerRestorer'),
      oerebQueryFormat: 'xml',
      infoPlugins: [{
        "key": "test",
        "title": "Test plugin",
        "query": "https://example.com/data.json",
        "pdfQuery": null,
        "urlKey": "null",
        "component": require('./plugins/PlotInfoTestPlugin')
      }]
    }
    
 * `themeLayerRestorer`: Function which restores theme layers, used for loading the `toolLayers` specified in the configuration in `config.json`. See `themeLayerRestorer` in the [sample `appConfig.js`](https://github.com/qgis/qwc2-demo-app/blob/master/js/appConfig.js).
 * `oerebQueryFormat`: Format of data returned by the OEREB backend one wishes to use, either `xml` or `json`.
 * `infoPlugins`: Customized info plugins. Differently from the `infoQueries` in `config.json`, these render a custom component, instead of static HTML in an iframe. A minimal plugin component:
 
       class PlotInfoTestPlugin extends React.Component {
         static propTypes = {
           data: PropTypes.object // PropType according to format of data returned by the specified query URL
         }
         render() {
           return (<div>{this.props.data.field}</div>);
         }
       };

       module.exports = PlotInfoTestPlugin;
