import { ErrorModal } from './errorModal';
import { DisplayItemFactory } from './displayItemFactory';

import { module as mod }  from './module';
export { module } from './module';

import './autocomplete';
import './codeValueInput';
import './codeValueInputAutocomplete';
import './excludeValidator';
import './stringInput';
import './prefixInput';
import './namespaceInput';
import './dataTypeInput';
import './bootstrapInput';
import './uriInput';
import './editable';
import './editableLabel';
import './editableEntityButtons';
import './errorMessages';
import './href';
import './idInput';
import './localizedInput';
import './modelLanguageChooser';
import './nonEditable';
import './languageInput';
import './restrictDuplicates';
import './editableStateSelect';
import './errorPanel';
import './localizedSelect';
import './maxInput';
import './minInput';
import './ignoreDirty';
import './ignoreForm';
import './dragSortable';
import './editableTable';
import './iowSelect';
import './inputPopup';

mod.service('errorModal', ErrorModal);
mod.service('displayItemFactory', DisplayItemFactory);
