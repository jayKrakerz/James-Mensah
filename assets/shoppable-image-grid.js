import { Component } from '@theme/component';
import { StandardEvents } from '@shopify/events';

const selectors = {
  trigger: '[data-shoppable-trigger]',
  template: '[data-shoppable-template]',
  content: '[data-shoppable-content]',
  product: '[data-shoppable-product]',
  variants: '[data-shoppable-variants]',
  optionControl: '[data-shoppable-option]',
  optionGroup: '[data-shoppable-option-group]',
  dropdown: '[data-shoppable-dropdown]',
  selectedText: '[data-shoppable-selected-text]',
  variantInput: '[data-shoppable-variant-id]',
  price: '[data-shoppable-price]',
  image: '[data-shoppable-image]',
  close: '[data-shoppable-close]',
};

/** @typedef {{ id: number, available: boolean, options: string[], price: string, image: string | null }} ShoppableVariant */

/**
 * Compact shoppable product grid with one reusable modal.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog
 * @property {HTMLElement} content
 * @property {HTMLButtonElement} closeButton
 *
 * @extends {Component<Refs>}
 */
class ShoppableImageGrid extends Component {
  requiredRefs = ['dialog', 'content', 'closeButton'];

  /** @type {HTMLElement | null} */
  activeTrigger = null;

  /** @type {ShoppableVariant[] | null} */
  variants = null;

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener('click', this.handleClick);
    this.addEventListener('change', this.handleChange);
    this.addEventListener(StandardEvents.cartLinesUpdate, this.handleCartUpdate);
    this.refs.dialog.addEventListener('close', this.handleDialogClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('change', this.handleChange);
    this.removeEventListener(StandardEvents.cartLinesUpdate, this.handleCartUpdate);
    this.refs.dialog.removeEventListener('close', this.handleDialogClose);
  }

  /** @param {MouseEvent} event */
  handleClick = (event) => {
    if (!(event.target instanceof Element)) return;

    const trigger = event.target.closest(selectors.trigger);
    if (trigger instanceof HTMLElement) {
      this.openProduct(trigger);
      return;
    }

    if (event.target.closest(selectors.close) || event.target === this.refs.dialog) {
      this.closeDialog();
      return;
    }

    // Clicking an already-checked radio will not emit `change`, so custom dropdowns need a click fallback.
    const optionControl = this.getClickedOptionControl(event.target);
    if (optionControl instanceof HTMLInputElement && optionControl.type === 'radio') {
      const product = optionControl.closest(selectors.product);
      if (!(product instanceof HTMLElement)) return;

      optionControl.checked = true;
      this.updateDropdownLabel(optionControl);
      this.updateProductVariant(product);
    }
  };

  /** @param {Event} event */
  handleChange = (event) => {
    if (!this.isOptionControl(event.target)) return;

    const product = event.target.closest(selectors.product);
    if (!(product instanceof HTMLElement)) return;

    this.updateDropdownLabel(event.target);
    this.updateProductVariant(product);
  };

  /** @param {import('@shopify/events').CartLinesUpdateEvent} event */
  handleCartUpdate = (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(selectors.content)) return;

    event.promise
      ?.then(({ detail }) => {
        if (!detail?.didError) this.closeDialog();
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[shoppable-image-grid] Cart update rejected:', error);
      });
  };

  handleDialogClose = () => {
    this.refs.content.replaceChildren();
    this.variants = null;

    if (this.activeTrigger?.isConnected) this.activeTrigger.focus();
    this.activeTrigger = null;
  };

  /** @param {HTMLElement} trigger */
  openProduct(trigger) {
    const template = trigger.parentElement?.querySelector(selectors.template);
    if (!(template instanceof HTMLTemplateElement)) return;

    this.refs.content.replaceChildren(template.content.cloneNode(true));
    this.cacheDefaultImage();
    this.variants = this.getVariants();
    this.activeTrigger = trigger;

    this.refs.dialog.showModal();
    this.refs.closeButton.focus();
  }

  closeDialog() {
    if (this.refs.dialog.open) this.refs.dialog.close();
  }

  cacheDefaultImage() {
    const image = this.refs.content.querySelector(selectors.image);
    if (!(image instanceof HTMLImageElement)) return;

    image.dataset.defaultSrc = image.src;
    image.dataset.defaultSrcset = image.srcset;
  }

  /** @returns {ShoppableVariant[]} */
  getVariants() {
    const variantsElement = this.refs.content.querySelector(selectors.variants);
    if (!variantsElement?.textContent) return [];

    try {
      return JSON.parse(variantsElement.textContent);
    } catch (error) {
      console.warn('[shoppable-image-grid] Invalid variant data:', error);
      return [];
    }
  }

  /** @param {HTMLElement} product */
  updateProductVariant(product) {
    const selectedOptions = this.getSelectedOptions(product);
    const variant = this.variants?.find((item) =>
      item.options.every((option, index) => option === selectedOptions[index])
    );

    this.updateVariantInput(product, variant);
    this.updatePrice(product, variant);
    this.updateImage(product, variant);
    this.updateButton(product, variant);
  }

  /** @param {HTMLSelectElement | HTMLInputElement} control */
  updateDropdownLabel(control) {
    const dropdown = control.closest(selectors.dropdown);
    if (!(dropdown instanceof HTMLDetailsElement)) return;

    const label = dropdown.querySelector(selectors.selectedText);
    if (label) label.textContent = control.value;

    dropdown.dataset.shoppableHasSelection = 'true';
    dropdown.open = false;
  }

  /** @param {HTMLElement} product */
  getSelectedOptions(product) {
    /** @type {string[]} */
    const selectedOptions = [];
    const optionGroups = product.querySelectorAll(selectors.optionGroup);

    for (const group of optionGroups) {
      if (!(group instanceof HTMLElement)) continue;

      const optionIndex = Number(group.dataset.shoppableOptionIndex);
      const control = group.querySelector('select, input[type="radio"]:checked');
      if (!Number.isInteger(optionIndex) || !this.isOptionControl(control)) continue;

      selectedOptions[optionIndex] = control.value;
    }

    return selectedOptions;
  }

  /** @param {EventTarget | null} target */
  isOptionControl(target) {
    return (
      (target instanceof HTMLSelectElement || target instanceof HTMLInputElement) &&
      target.matches(selectors.optionControl)
    );
  }

  /** @param {Element} target */
  getClickedOptionControl(target) {
    if (this.isOptionControl(target)) return target;

    const optionLabel = target.closest('label');
    const control = optionLabel?.querySelector(selectors.optionControl);
    return this.isOptionControl(control) ? control : null;
  }

  /** @param {HTMLElement} product @param {ShoppableVariant | undefined} variant */
  updateVariantInput(product, variant) {
    const variantInput = product.querySelector(selectors.variantInput);
    if (variantInput instanceof HTMLInputElement) variantInput.value = variant?.id?.toString() || '';
  }

  /** @param {HTMLElement} product @param {ShoppableVariant | undefined} variant */
  updatePrice(product, variant) {
    const price = product.querySelector(selectors.price);
    if (price && variant?.price) price.textContent = variant.price;
  }

  /** @param {HTMLElement} product @param {ShoppableVariant | undefined} variant */
  updateImage(product, variant) {
    const image = product.querySelector(selectors.image);
    if (!(image instanceof HTMLImageElement)) return;

    image.src = variant?.image || image.dataset.defaultSrc || image.src;
    image.srcset = variant?.image || image.dataset.defaultSrcset || image.srcset;
  }

  /** @param {HTMLElement} product @param {ShoppableVariant | undefined} variant */
  updateButton(product, variant) {
    const button = product.querySelector('[ref="addToCartButton"]');
    if (!(button instanceof HTMLButtonElement)) return;

    button.disabled = !variant?.available;
    button.toggleAttribute('aria-disabled', !variant?.available);
  }
}

if (!customElements.get('shoppable-image-grid')) {
  customElements.define('shoppable-image-grid', ShoppableImageGrid);
}
