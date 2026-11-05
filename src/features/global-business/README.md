# 全球业务看板

业务项目、市场线索、产品资料、国家运营资源和变更记录保存在 PostgreSQL。前端只包含组件、字段定义及公开地理边界，不内置业务项目数据。

`world-map.json` 是 Natural Earth 1:110m 国家边界经 Natural Earth 投影生成的 SVG 路径；地理数据为公有领域，来源说明见 https://www.naturalearthdata.com/about/terms-of-use/ 。构建时使用 d3-geo 3.1.1 与 topojson-client 3.1.0；运行时无需地图服务和密钥。

产品问答默认 API 只使用已确认资料。试用界面可明确勾选包含待核对资料，回答与来源必须标明其状态。模型配置始终由服务端统一管理。

国家中文名称由 i18n-iso-countries 的 ISO 3166 数据生成（MIT 许可），地理边界与业务统计独立。未登记业务数据的国家不虚构项目或运营能力。
