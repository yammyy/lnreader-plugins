"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var _69shu_1 = __importDefault(require("@plugins/chinese/69shu"));
var Quanben_1 = __importDefault(require("@plugins/chinese/Quanben"));
var ixdzs8_1 = __importDefault(require("@plugins/chinese/ixdzs8"));
var novel543_1 = __importDefault(require("@plugins/chinese/novel543"));
var novelupdates_1 = __importDefault(require("@plugins/english/novelupdates"));
var Syosetu_1 = __importDefault(require("@plugins/japanese/Syosetu"));
var kakuyomu_1 = __importDefault(require("@plugins/japanese/kakuyomu"));
var aerialrain_1 = __importDefault(require("@plugins/english/aerialrain"));
var aihristdream_1 = __importDefault(require("@plugins/english/aihristdream"));
var BOTITranslation_1 = __importDefault(require("@plugins/english/BOTITranslation"));
var brightnovels_1 = __importDefault(require("@plugins/english/brightnovels"));
var FancyTL_1 = __importDefault(require("@plugins/english/FancyTL"));
var literaturecity_1 = __importDefault(require("@plugins/english/literaturecity"));
var mistminthaven_1 = __importDefault(require("@plugins/english/mistminthaven"));
var novelishuniverse_1 = __importDefault(require("@plugins/english/novelishuniverse"));
var readhive_1 = __importDefault(require("@plugins/english/readhive"));
var ShanghaiFantasy_1 = __importDefault(require("@plugins/english/ShanghaiFantasy"));
var snoutandco_1 = __importDefault(require("@plugins/english/snoutandco"));
var transcendentaltls_1 = __importDefault(require("@plugins/english/transcendentaltls"));
var novelshub_1 = __importDefault(require("@plugins/english/novelshub"));
var betwixtedbutterfly_1 = __importDefault(require("@plugins/english/betwixtedbutterfly"));
var wuxiaworldeu_1 = __importDefault(require("@plugins/english/wuxiaworldeu"));
var dragonholictranslations_1 = __importDefault(require("@plugins/english/dragonholictranslations"));
var wuxiatranslate_1 = __importDefault(require("@plugins/english/wuxiatranslate"));
var _52shuku_1 = __importDefault(require("@plugins/chinese/52shuku"));
var _69xinshu_1 = __importDefault(require("@plugins/chinese/69xinshu"));
var ab9a1c1018b5_5df7ec_cdf_1 = __importDefault(require("@plugins/chinese/ab9a1c1018b5.5df7ec.cdf"));
var drxsw_1 = __importDefault(require("@plugins/chinese/drxsw"));
var haiwaishubao_1 = __importDefault(require("@plugins/chinese/haiwaishubao"));
var ixdzs8_2 = __importDefault(require("@plugins/chinese/ixdzs8"));
var m_de2a08a_1 = __importDefault(require("@plugins/chinese/m.de2a08a"));
var mfirst_haiyuangabiou_1 = __importDefault(require("@plugins/chinese/mfirst.haiyuangabiou"));
var Lulobox_madara_1 = __importDefault(require("@plugins/english/Lulobox[madara]"));
var AzureChronicles_madara_1 = __importDefault(require("@plugins/english/AzureChronicles[madara]"));
var Foxaholic18_madara_1 = __importDefault(require("@plugins/english/Foxaholic18[madara]"));
var LovelyBlossoms_madara_1 = __importDefault(require("@plugins/english/LovelyBlossoms[madara]"));
var MoonlightTeatime_madara_1 = __importDefault(require("@plugins/english/MoonlightTeatime[madara]"));
var NovelBike_madara_1 = __importDefault(require("@plugins/english/NovelBike[madara]"));
var StoriesEcho_madara_1 = __importDefault(require("@plugins/english/StoriesEcho[madara]"));
var WordRain_madara_1 = __importDefault(require("@plugins/english/WordRain[madara]"));
var ClownCo_madara_1 = __importDefault(require("@plugins/english/ClownCo[madara]"));
var BelleRepository_madara_1 = __importDefault(require("@plugins/english/BelleRepository[madara]"));
var bcatranslation_madara_1 = __importDefault(require("@plugins/english/bcatranslation[madara]"));
var NovelLib_fictioneer_1 = __importDefault(require("@plugins/english/NovelLib[fictioneer]"));
var SyosetuW_1 = __importDefault(require("@plugins/japanese/SyosetuW"));
var SyosetuM_1 = __importDefault(require("@plugins/japanese/SyosetuM"));
var SyosetuG_1 = __importDefault(require("@plugins/japanese/SyosetuG"));
var PLUGINS = [
    _69shu_1.default,
    Quanben_1.default,
    ixdzs8_1.default,
    novel543_1.default,
    novelupdates_1.default,
    Syosetu_1.default,
    kakuyomu_1.default,
    aerialrain_1.default,
    aihristdream_1.default,
    BOTITranslation_1.default,
    brightnovels_1.default,
    FancyTL_1.default,
    literaturecity_1.default,
    mistminthaven_1.default,
    novelishuniverse_1.default,
    readhive_1.default,
    ShanghaiFantasy_1.default,
    snoutandco_1.default,
    transcendentaltls_1.default,
    novelshub_1.default,
    betwixtedbutterfly_1.default,
    wuxiaworldeu_1.default,
    dragonholictranslations_1.default,
    wuxiatranslate_1.default,
    _52shuku_1.default,
    _69xinshu_1.default,
    ab9a1c1018b5_5df7ec_cdf_1.default,
    drxsw_1.default,
    haiwaishubao_1.default,
    ixdzs8_2.default,
    m_de2a08a_1.default,
    mfirst_haiyuangabiou_1.default,
    Lulobox_madara_1.default,
    AzureChronicles_madara_1.default,
    Foxaholic18_madara_1.default,
    LovelyBlossoms_madara_1.default,
    MoonlightTeatime_madara_1.default,
    NovelBike_madara_1.default,
    StoriesEcho_madara_1.default,
    WordRain_madara_1.default,
    ClownCo_madara_1.default,
    BelleRepository_madara_1.default,
    NovelLib_fictioneer_1.default,
    bcatranslation_madara_1.default,
    SyosetuW_1.default,
    SyosetuM_1.default,
    SyosetuG_1.default,
];
exports.default = PLUGINS;
